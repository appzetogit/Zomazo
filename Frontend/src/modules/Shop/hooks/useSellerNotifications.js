import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { API_BASE_URL } from '@store/api/config';
import { sellerAPI } from '@store/api';
import { dispatchNotificationInboxRefresh } from '@store/hooks/useNotificationInbox';
import {
  attachSellerAlertUnlockListeners,
  getSellerOrderAlertKey,
  startSellerAlert,
  stopAllSellerAlerts,
  stopSellerAlert,
  syncSellerAlertsWithOrders,
} from '@store/utils/sellerAlertSession';

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const supportsBrowserNotifications = () =>
  typeof window !== 'undefined' && typeof Notification !== 'undefined';

const buildSellerOrderNotification = (orderData = {}) => {
  const orderId = orderData.orderId || orderData.orderMongoId || 'New';
  const itemCount = Array.isArray(orderData.items) ? orderData.items.length : 0;
  const total = Number(orderData.total || orderData.pricing?.total || 0);

  return {
    title: `New order #${orderId}`,
    body: itemCount > 0
      ? `${itemCount} item${itemCount === 1 ? '' : 's'} - ₹${total.toFixed(2)}`
      : 'A new order is waiting for review',
    tag: `seller-order-${orderId}`,
    data: {
      orderId,
      targetUrl: `/seller/orders/${orderData.orderMongoId || orderData.orderId || ''}`,
    },
  };
}

/**
 * Hook for seller to receive real-time order notifications.
 * Sound is owned by sellerAlertSession (single looping session).
 * @returns {object} - { newOrder, clearNewOrder, playNotificationSound, isConnected }
 */
export const useSellerNotifications = () => {
  const socketRef = useRef(null);
  const [newOrder, setNewOrder] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const activeOrderRef = useRef(null);
  const [sellerId, setSellerId] = useState(null);
  const lastConnectErrorLogRef = useRef(0);
  const lastAlertAtByOrderRef = useRef(new Map());
  const lastBrowserNotificationAtByOrderRef = useRef(new Map());
  const CONNECT_ERROR_LOG_THROTTLE_MS = 10000;
  /** UI / poll spam guard only — session itself is the sound idempotency layer. */
  const ALERT_DEDUPE_MS = 15000;
  const BROWSER_NOTIFICATION_DEDUPE_MS = 20000;
  const NOTIFICATION_PERMISSION_ASKED_KEY = 'seller_notification_permission_asked';

  const getOrderAlertKey = (orderData = {}) => getSellerOrderAlertKey(orderData);

  const shouldProcessOrderAlert = (orderData = {}) => {
    const key = getOrderAlertKey(orderData);
    if (!key) return true;
    const now = Date.now();
    const last = lastAlertAtByOrderRef.current.get(key) || 0;
    if (now - last < ALERT_DEDUPE_MS) return false;
    lastAlertAtByOrderRef.current.set(key, now);
    return true;
  };

  const shouldShowBrowserNotification = (orderData = {}) => {
    const key = getOrderAlertKey(orderData);
    if (!key) return true;
    const now = Date.now();
    const last = lastBrowserNotificationAtByOrderRef.current.get(key) || 0;
    if (now - last < BROWSER_NOTIFICATION_DEDUPE_MS) return false;
    lastBrowserNotificationAtByOrderRef.current.set(key, now);
    return true;
  };

  const showBackgroundOrderNotification = async (orderData) => {
    if (!shouldShowBrowserNotification(orderData)) {
      return;
    }

    if (!supportsBrowserNotifications() || Notification.permission !== 'granted') {
      return;
    }

    const notificationOptions = buildSellerOrderNotification(orderData);

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          // silent: session owns the ringtone; OS chime would duplicate.
          await registration.showNotification(notificationOptions.title, {
            body: notificationOptions.body,
            tag: notificationOptions.tag,
            renotify: true,
            requireInteraction: true,
            silent: true,
            vibrate: [200, 100, 200, 100, 300],
            icon: '/favicon.ico',
            data: notificationOptions.data,
          });
          return;
        }
      }

      new Notification(notificationOptions.title, {
        body: notificationOptions.body,
        tag: notificationOptions.tag,
        requireInteraction: true,
        silent: true,
        icon: '/favicon.ico',
        data: notificationOptions.data,
      });
    } catch (error) {
      debugWarn('Error showing background seller notification:', error);
    }
  };

  const playNotificationSound = async (orderData = {}) => {
    await startSellerAlert(orderData || activeOrderRef.current || {});
  };

  const handleIncomingOrderAlert = (orderData) => {
    if (!shouldProcessOrderAlert(orderData)) {
      // Still ensure session knows about this pending id (idempotent sound).
      void startSellerAlert(orderData);
      return;
    }

    activeOrderRef.current = orderData || { id: Date.now() };
    void startSellerAlert(orderData);

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      showBackgroundOrderNotification(orderData);
    }
  };

  // Get seller ID from API
  useEffect(() => {
    const fetchSellerId = async () => {
      try {
        const response = await sellerAPI.getCurrentSeller();
        if (response.data?.success && response.data.data?.seller) {
          const seller = response.data.data.seller;
          const id = seller._id?.toString() || seller.sellerId;
          setSellerId(id);
        }
      } catch (error) {
        debugError('Error fetching seller:', error);
      }
    };
    fetchSellerId();
  }, []);

  // Reliability fallback:
  // If Socket.IO fails (expired jwt / missing token / room join failed),
  // we still fetch seller orders from REST periodically and trigger the same
  // alert flow. This prevents "seller didn't receive the order" cases.
  useEffect(() => {
    if (!sellerId) return;

    const ALERT_POLL_MS = 20000;
    let isCancelled = false;

    const pollOrders = async () => {
      if (isCancelled) return;

      try {
        const response = await sellerAPI.getOrders({ page: 1, limit: 30 });
        const rows =
          response?.data?.data?.orders ||
          response?.data?.data?.data?.orders ||
          [];

        // REST layer normalizes backend statuses so:
        // - backend "created" -> UI "confirmed"
        // We alert only for "confirmed/new order waiting for review".
        const confirmed = (rows || [])
          .filter((o) => String(o?.status || "").toLowerCase() === "confirmed")
          .sort((a, b) => {
            const at = a?.updatedAt || a?.createdAt || 0;
            const bt = b?.updatedAt || b?.createdAt || 0;
            return new Date(bt).getTime() - new Date(at).getTime();
          });

        if (confirmed.length > 0) {
          // Trigger alerts for newest confirmed orders (session dedupes sound).
          confirmed.slice(0, 5).forEach((o) => handleIncomingOrderAlert(o));
          syncSellerAlertsWithOrders(confirmed);
        } else {
          // No waiting orders — silence any leftover session.
          syncSellerAlertsWithOrders([]);
        }
      } catch (error) {
        // Non-blocking: keep polling.
      }
    };

    // Initial poll immediately.
    pollOrders();
    const intervalId = setInterval(pollOrders, ALERT_POLL_MS);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [sellerId]);

  useEffect(() => {
    if (!supportsBrowserNotifications()) return;

    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(NOTIFICATION_PERMISSION_ASKED_KEY) === 'true') return;

    const requestPermissionOnce = async () => {
      localStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, 'true');
      try {
        await Notification.requestPermission();
      } catch (error) {
        debugWarn('Failed to request seller notification permission:', error);
      }
    };

    const askOnInteraction = () => {
      requestPermissionOnce();
      window.removeEventListener('pointerdown', askOnInteraction);
      window.removeEventListener('keydown', askOnInteraction);
    };

    window.addEventListener('pointerdown', askOnInteraction, { once: true, passive: true });
    window.addEventListener('keydown', askOnInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', askOnInteraction);
      window.removeEventListener('keydown', askOnInteraction);
    };
  }, []);

  useEffect(() => {
    const detachUnlock = attachSellerAlertUnlockListeners();
    return () => {
      detachUnlock?.();
    };
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'hidden') return;
      if (!activeOrderRef.current) return;

      // Keep browser banner; sound stays on the shared looping session.
      void startSellerAlert(activeOrderRef.current);
      showBackgroundOrderNotification(activeOrderRef.current);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!API_BASE_URL || !String(API_BASE_URL).trim()) {
      setIsConnected(false);
      return;
    }
    if (!sellerId) {
      debugLog('? Waiting for sellerId...');
      return;
    }

    // Normalize backend URL - use simpler, more robust approach
    let backendUrl = API_BASE_URL;
    
    // Step 1: Extract protocol and hostname using URL parsing if possible
    try {
      const urlObj = new URL(backendUrl);
      // Remove /api from pathname
      let pathname = urlObj.pathname.replace(/^\/api\/?$/, '');
      // Reconstruct clean URL
      backendUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.port ? `:${urlObj.port}` : ''}${pathname}`;
    } catch (e) {
      // If URL parsing fails, use regex-based normalization
      // Remove /api suffix first
      backendUrl = backendUrl.replace(/\/api\/?$/, '');
      backendUrl = backendUrl.replace(/\/+$/, ''); // Remove trailing slashes
      
      // Normalize protocol - ensure exactly two slashes after protocol
      // Fix patterns: https:/, https:///, https://https://
      if (backendUrl.startsWith('https:') || backendUrl.startsWith('http:')) {
        // Extract protocol
        const protocolMatch = backendUrl.match(/^(https?):/i);
        if (protocolMatch) {
          const protocol = protocolMatch[1].toLowerCase();
          // Remove everything up to and including the first valid domain part
          const afterProtocol = backendUrl.substring(protocol.length + 1);
          // Remove leading slashes
          const cleanPath = afterProtocol.replace(/^\/+/, '');
          // Reconstruct with exactly two slashes
          backendUrl = `${protocol}://${cleanPath}`;
        }
      }
    }
    
    // Final cleanup: ensure exactly two slashes after protocol
    backendUrl = backendUrl.replace(/^(https?):\/+/gi, '$1://');
    backendUrl = backendUrl.replace(/\/+$/, ''); // Remove trailing slashes
    
    // CRITICAL: Check for localhost in production BEFORE creating socket
    // Detect production environment more reliably
    const frontendHostname = window.location.hostname;
    const isLocalhost = frontendHostname === 'localhost' || 
                        frontendHostname === '127.0.0.1' ||
                        frontendHostname === '';
    const isProductionBuild = import.meta.env.MODE === 'production' || import.meta.env.PROD;
    // Production deployment: not localhost AND (HTTPS OR has domain name with dots)
    const isProductionDeployment = !isLocalhost && (
      window.location.protocol === 'https:' || 
      (frontendHostname.includes('.') && !frontendHostname.startsWith('192.168.') && !frontendHostname.startsWith('10.'))
    );
    
    // If backend URL is localhost but we're not running locally, BLOCK connection
    const backendIsLocalhost = backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1');
    // Block if: backend is localhost AND (production build OR production deployment)
    // Allow if: frontend is also localhost (development scenario)
    const shouldBlockConnection = backendIsLocalhost && (isProductionBuild || isProductionDeployment) && !isLocalhost;
    
    if (shouldBlockConnection) {
      // Try to infer backend URL from frontend URL (common pattern: api.domain.com or domain.com/api)
      const frontendHost = window.location.hostname;
      const frontendProtocol = window.location.protocol;
      let suggestedBackendUrl = null;
      
      // Common pattern: the API on an api. subdomain of the site.
      if (frontendHost && frontendHost !== 'localhost') {
        suggestedBackendUrl = `${frontendProtocol}//api.${frontendHost}/api`;
      }
      
      debugError('? CRITICAL: BLOCKING Socket.IO connection to localhost!');
      debugError('Backend connectivity disabled (UI-only mode).');
      debugError('?? Current backendUrl:', backendUrl);
      debugError('?? Current API_BASE_URL:', API_BASE_URL);
      debugError('?? Frontend hostname:', frontendHost);
      debugError('?? Frontend protocol:', frontendProtocol);
      debugError('?? Is production build:', isProductionBuild);
      debugError('?? Is production deployment:', isProductionDeployment);
      debugError('?? Backend is localhost:', backendIsLocalhost);
      if (suggestedBackendUrl) {
        debugError('?? Suggested backend URL:', suggestedBackendUrl);
      } else {
        debugError('?? Backend URL config is disabled in this build.');
      }
      debugError('?? Backend URL config is disabled in this build.');
      
      // Clean up any existing socket connection
      if (socketRef.current) {
        debugLog('?? Cleaning up existing socket connection...');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      
      // Don't try to connect to localhost in production - it will fail
      setIsConnected(false);
      return; // CRITICAL: Exit early to prevent socket creation
    }
    
    // Validate backend URL format
    if (!backendUrl || !backendUrl.startsWith('http')) {
      debugError('? CRITICAL: Invalid backend URL format:', backendUrl);
      debugError('?? API_BASE_URL:', API_BASE_URL);
      debugError('?? Expected format: https://your-domain.com or ');
      setIsConnected(false);
      return; // Don't try to connect with invalid URL
    }
    
    // Construct Socket.IO URL
    // IMPORTANT: Socket.IO server is on the origin (not /api/v1).
    // Our API baseURL is typically like: http://localhost:5000/api/v1
    // So for sockets we always connect to: http://localhost:5000
    let socketOrigin = backendUrl;
    try {
      socketOrigin = new URL(backendUrl).origin;
    } catch {
      socketOrigin = String(backendUrl || "")
        .replace(/\/api\/v\d+\/?$/i, "")
        .replace(/\/api\/?$/i, "")
        .replace(/\/+$/, "");
    }

    // Backend uses default namespace; rooms handle role separation.
    const socketUrl = `${socketOrigin}`;
    
    // Validate socket URL format
    try {
      const urlTest = new URL(socketUrl); // This will throw if URL is invalid
      // Additional validation: ensure it's not localhost in production
      if ((isProductionBuild || isProductionDeployment) && (urlTest.hostname === 'localhost' || urlTest.hostname === '127.0.0.1')) {
        debugError('? CRITICAL: Socket URL contains localhost in production!');
        debugError('?? Socket URL:', socketUrl);
        debugError('?? This should have been caught earlier, but blocking anyway');
        setIsConnected(false);
        return;
      }
    } catch (urlError) {
      debugError('? CRITICAL: Invalid Socket.IO URL:', socketUrl);
      debugError('?? URL validation error:', urlError.message);
      debugError('?? Backend URL:', backendUrl);
      debugError('?? API_BASE_URL:', API_BASE_URL);
      setIsConnected(false);
      return; // Don't try to connect with invalid URL
    }
    
    debugLog('?? Attempting to connect to Socket.IO:', socketUrl);
    debugLog('?? Backend URL:', backendUrl);
    debugLog('?? API_BASE_URL:', API_BASE_URL);
    debugLog('?? Seller ID:', sellerId);
    debugLog('?? Environment:', import.meta.env.MODE);
    debugLog('?? Is Production Build:', isProductionBuild);
    debugLog('?? Is Production Deployment:', isProductionDeployment);

    // Initialize socket connection (default namespace)
    // Use polling only to avoid repeated "WebSocket connection failed" when backend is down
    socketRef.current = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      forceNew: false,
      autoConnect: true,
      auth: {
        token: localStorage.getItem('seller_accessToken') || localStorage.getItem('accessToken')
      }
    });

    socketRef.current.on('connect', () => {
      debugLog('? Seller Socket connected, sellerId:', sellerId);
      debugLog('? Socket ID:', socketRef.current.id);
      debugLog('? Socket URL:', socketUrl);
      setIsConnected(true);
      
      // Join seller room immediately after connection with retry
      if (sellerId) {
        const joinRoom = () => {
          debugLog('?? Joining seller room with ID:', sellerId);
          socketRef.current.emit('join-seller', sellerId);
          
          // Retry join after 2 seconds if no confirmation received
          setTimeout(() => {
            if (socketRef.current?.connected) {
              debugLog('?? Retrying seller room join...');
              socketRef.current.emit('join-seller', sellerId);
            }
          }, 2000);
        };
        
        joinRoom();
      } else {
        debugWarn('?? Cannot join seller room: sellerId is missing');
      }
    });

    // Listen for room join confirmation
    socketRef.current.on('seller-room-joined', (data) => {
      debugLog('? Seller room joined successfully:', data);
      debugLog('? Room:', data?.room);
      debugLog('? Seller ID in room:', data?.sellerId);
    });

    // Listen for connection errors (throttle logs to avoid console spam on reconnect loops)
    socketRef.current.on('connect_error', (error) => {
      const now = Date.now();
      const shouldLog = now - lastConnectErrorLogRef.current >= CONNECT_ERROR_LOG_THROTTLE_MS;
      if (shouldLog) {
        lastConnectErrorLogRef.current = now;
        const isTransportError = error.type === 'TransportError' || error.message?.includes('xhr poll error');
        debugWarn(
          'Seller Socket:',
          isTransportError
            ? `Cannot reach backend at ${backendUrl}. Ensure the backend is running (e.g. npm run dev in backend).`
            : error.message
        );
        if (!isTransportError) {
          debugWarn('Details:', { type: error.type, socketUrl, backendUrl });
        }
      }
      if (error.message?.includes('CORS') || error.message?.includes('Not allowed')) {
        debugWarn('?? Add frontend URL to CORS_ORIGIN in backend .env');
      }
      setIsConnected(false);
    });

    // Listen for disconnection
    socketRef.current.on('disconnect', (reason) => {
      debugLog('? Seller Socket disconnected:', reason);
      setIsConnected(false);
      
      if (reason === 'io server disconnect') {
        // Server disconnected the socket, reconnect manually
        socketRef.current.connect();
      }
    });

    // Listen for reconnection attempts
    socketRef.current.on('reconnect_attempt', (attemptNumber) => {
      debugLog(`?? Reconnection attempt ${attemptNumber}...`);
    });

    // Listen for successful reconnection
    socketRef.current.on('reconnect', (attemptNumber) => {
      debugLog(`? Reconnected after ${attemptNumber} attempts`);
      setIsConnected(true);
      
      // Rejoin seller room after reconnection
      if (sellerId) {
        socketRef.current.emit('join-seller', sellerId);
      }
    });

    // Listen for new order notifications
    socketRef.current.on('new_order', (orderData) => {
      debugLog('?? New order received:', orderData);
      setNewOrder(orderData);

      handleIncomingOrderAlert(orderData);

      // Broadcast so OrdersMain can queue concurrent orders (single React state would overwrite).
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('seller:new_order', { detail: orderData }),
        );
      }
    });

    // Listen for sound notification event (legacy; backend may not emit)
    socketRef.current.on('play_notification_sound', (data) => {
      debugLog('?? Sound notification:', data);
      const normalizedData = {
        orderId: data?.orderId || data?.order_id,
        orderMongoId: data?.orderMongoId || data?.order_mongo_id,
        ...data
      };
      activeOrderRef.current = normalizedData || { id: Date.now() };
      handleIncomingOrderAlert(normalizedData);
    });

    // Listen for order status updates
    socketRef.current.on('order_status_update', (data) => {
      debugLog('?? Order status update:', data);
      
      const status = String(data?.orderStatus || data?.status || "").toLowerCase();
      
      // Clear popup if the active order's status changes to anything other than "pending"
      // This handles cases where an Admin accepts/rejects the order while the popup is open
      if (status && status !== 'pending' && status !== 'created' && status !== 'confirmed') {
        // Dispatch a custom event so components can react to the external status change
        window.dispatchEvent(new CustomEvent('sellerOrderHandledExternally', { 
          detail: { 
            orderId: data.orderId || data.id, 
            orderMongoId: data.orderMongoId || data.orderId || data.id,
            status: status 
          } 
        }));

        stopSellerAlert(data);

        if (activeOrderRef.current) {
          const activeId = getOrderAlertKey(activeOrderRef.current);
          const updateKeys = [
            data?.orderMongoId,
            data?.orderId,
            data?.id,
          ].map((v) => (v == null ? '' : String(v).trim())).filter(Boolean);

          if (!activeId || updateKeys.includes(activeId)) {
            debugLog(`?? Active order status changed to ${status}, clearing popup...`);
            clearNewOrder();
          }
        }
      }
    });

    socketRef.current.on('admin_notification', (payload) => {
      debugLog('?? Admin broadcast received:', payload);
      dispatchNotificationInboxRefresh();
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [sellerId]);

  const clearNewOrder = (orderLike) => {
    const target = orderLike || activeOrderRef.current || newOrder;
    if (target) {
      stopSellerAlert(target);
    } else {
      stopAllSellerAlerts();
    }
    activeOrderRef.current = null;
    setNewOrder(null);
  };

  return {
    newOrder,
    clearNewOrder,
    isConnected,
    playNotificationSound
  };
};




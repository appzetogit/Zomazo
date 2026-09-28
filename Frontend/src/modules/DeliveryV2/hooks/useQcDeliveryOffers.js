import { useCallback, useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { API_BASE_URL } from '@food/api/config';
import { qcDeliveryAPI } from '@food/api';
import { SERVICE_QUICK, tagOrder, extractOrderList, isOfferable, orderKey } from '@/modules/DeliveryV2/utils/service';

/**
 * Quick-commerce offers for the rider app.
 *
 * Quick commerce dispatches on its own Socket.IO namespace, /qc, to the room of
 * the rider's grocery-pool id. The server maps the rider's food token to that
 * id on connect, so the socket just connects -- no join event is needed (and
 * the food partner id this app knows would be the wrong one to join with).
 *
 * The socket is backed by `poll()` -- the current QC trip, else an open offer
 * from /qc/delivery/orders/available -- which the feed calls on the same timer
 * as its food poll: a backgrounded tab or a dropped connection must not lose
 * the offer.
 *
 * If quick commerce refuses this rider (401/403: not approved there, or the
 * bridge switched off) the hook goes quiet for the session instead of polling
 * a door that will not open.
 */
const socketOrigin = () => {
  try {
    const base = String(API_BASE_URL || '');
    if (!base.trim()) return null;
    return new URL(base, base.startsWith('http') ? undefined : window.location.origin).origin;
  } catch {
    return null;
  }
};

export const useQcDeliveryOffers = ({ enabled = true } = {}) => {
  const socketRef = useRef(null);
  const [offer, setOffer] = useState(null);
  const [statusUpdate, setStatusUpdate] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [refused, setRefused] = useState(false);
  const dismissedRef = useRef(new Set());

  const active = enabled && !refused;

  const takeOffer = useCallback((raw) => {
    const order = tagOrder(raw, SERVICE_QUICK);
    const key = orderKey(order);
    if (!key || dismissedRef.current.has(key)) return;
    setOffer((prev) => (prev && orderKey(prev) === key ? prev : order));
  }, []);

  // Socket on the /qc namespace.
  useEffect(() => {
    if (!active) return undefined;
    const origin = socketOrigin();
    const token = localStorage.getItem('delivery_accessToken');
    if (!origin || !token) return undefined;

    const socket = io(`${origin}/qc`, {
      path: '/socket.io/',
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('connect_error', () => setIsConnected(false));
    socket.on('new_order', takeOffer);
    socket.on('new_order_available', takeOffer);
    socket.on('order_claimed', (data) => {
      const claimed = String(data?.orderMongoId || data?.orderId || '');
      setOffer((prev) => (prev && orderKey(prev) === claimed ? null : prev));
    });
    socket.on('order_status_update', (data) => setStatusUpdate(tagOrder(data, SERVICE_QUICK)));

    const onRefreshed = (e) => {
      if (e.detail?.module !== 'delivery' || !e.detail?.token) return;
      socket.auth.token = e.detail.token;
      if (!socket.connected) socket.connect();
    };
    window.addEventListener('authRefreshed', onRefreshed);

    return () => {
      window.removeEventListener('authRefreshed', onRefreshed);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [active, takeOffer]);

  /** One look at the server: the rider's current QC trip, else an open offer. */
  const poll = useCallback(async () => {
    if (!active) return { current: null, offer: null };
    try {
      const currentRes = await qcDeliveryAPI.getCurrentDelivery();
      const current = currentRes?.data?.data?.activeOrder || null;
      if (current && (current._id || current.orderId)) {
        return { current: tagOrder(current, SERVICE_QUICK), offer: null };
      }
      const list = extractOrderList(await qcDeliveryAPI.getOrders());
      const next = list.find((o) => isOfferable(o) && !dismissedRef.current.has(orderKey(o)));
      if (next) takeOffer(next);
      return { current: null, offer: next ? tagOrder(next, SERVICE_QUICK) : null };
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) setRefused(true);
      return { current: null, offer: null };
    }
  }, [active, takeOffer]);

  /** The rider accepted or passed: never show this one again this session. */
  const clearOffer = useCallback((order) => {
    const key = orderKey(order || offer);
    if (key) dismissedRef.current.add(key);
    setOffer(null);
  }, [offer]);

  const clearStatusUpdate = useCallback(() => setStatusUpdate(null), []);

  /** Live position for a QC trip: the customer's tracking room is on /qc. */
  const emitLocation = useCallback((payload) => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('update-location', payload);
      return true;
    }
    return false;
  }, []);

  return { offer, clearOffer, statusUpdate, clearStatusUpdate, isConnected, poll, emitLocation, refused };
};

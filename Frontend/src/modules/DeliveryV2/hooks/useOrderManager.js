import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { toast } from 'sonner';
import { apiForOrder, tagOrder } from '@/modules/DeliveryV2/utils/service';

/**
 * useOrderManager - Professional hook for real-world trip lifecycle actions.
 * Connects directly to the backend API services.
 *
 * Each action goes to the vertical the job came from -- food or quick commerce
 * (see utils/service.js) -- and the active order keeps its `service` tag.
 */
export const useOrderManager = () => {
  const { 
    activeOrder, tripStatus, updateTripStatus, clearActiveOrder, setActiveOrder, riderLocation 
  } = useDeliveryStore();

  const acceptOrder = async (order) => {
    const orderId = order?.orderMongoId || order?._id || order?.orderId || order?.id;
    if (!orderId) {
      toast.error('Invalid order data');
      return;
    }

    try {
      const response = await apiForOrder(order).acceptOrder(orderId);
      
      if (response?.data?.success) {
        const fullOrder = response.data.data?.order || order;
        
        // Robustly determine locations from multiple possible formats (Populated API vs Socket)
        const getLoc = (ref, keysLat, keysLng) => {
          if (!ref) return null;
          // Handle nested populated objects
          if (ref.location) {
            // Handle GeoJSON format: location: { type: 'Point', coordinates: [lng, lat] }
            if (Array.isArray(ref.location.coordinates) && ref.location.coordinates.length >= 2) {
              return {
                lat: ref.location.coordinates[1], // Latitude is second in GeoJSON [lng, lat]
                lng: ref.location.coordinates[0]  // Longitude is first
              };
            }
            // Handle standard object format: location: { latitude: 12.3, longitude: 45.6 }
            return {
              lat: ref.location.latitude || ref.location.lat,
              lng: ref.location.longitude || ref.location.lng
            };
          }
          // Handle flat objects or direct lat/lng keys
          for (const k of keysLat) { if (ref[k] != null) return { lat: ref[k], lng: ref[keysLng[keysLat.indexOf(k)]] }; }
          return null;
        };

        console.log('[OrderManager] Raw Full Order Data:', fullOrder);

        const resLoc = getLoc(fullOrder.restaurantId, ['latitude', 'lat'], ['longitude', 'lng']) || 
                       getLoc(fullOrder, ['restaurant_lat', 'restaurantLat', 'latitude'], ['restaurant_lng', 'restaurantLng', 'longitude']);
                       
        const cusLoc = getLoc(fullOrder.deliveryAddress, ['latitude', 'lat'], ['longitude', 'lng']) || 
                       getLoc(fullOrder, ['customer_lat', 'customerLat', 'latitude'], ['customer_lng', 'customerLng', 'longitude']);

        console.log('[OrderManager] Locations Mapped Result:', { resLoc, cusLoc });

        setActiveOrder({
          ...fullOrder,
          service: order?.service,
          orderId: fullOrder.orderId || orderId,
          orderMongoId: fullOrder.orderMongoId || fullOrder._id || orderId,
          restaurantLocation: resLoc,
          customerLocation: cusLoc
        });

        updateTripStatus('PICKING_UP');
        // toast.success('Order Accepted! Opening Map...');
      } else {
        toast.error(response?.data?.message || 'Order already taken or unavailable');
        throw new Error('Accept failed');
      }
    } catch (error) {
      console.error('Accept Order Error:', error);
      // The server's reason (busy on another job, order taken) beats a generic one.
      toast.error(error?.response?.data?.message || 'Network error. Please try again.');
      throw error;
    }
  };

  /**
   * Mark "Reached Pickup" (Arrival at restaurant)
   */
  const reachPickup = async () => {
    const orderId = activeOrder?.orderMongoId || activeOrder?._id || activeOrder?.orderId;
    try {
      const response = await apiForOrder(activeOrder).confirmReachedPickup(orderId);
      if (response?.data?.success) {
        updateTripStatus('REACHED_PICKUP');
        // toast.info('Arrived at Restaurant');
      } else {
        throw new Error('Confirm pickup failed');
      }
    } catch (error) {
      toast.error('Failed to update status');
      throw error;
    }
  };

  /**
   * Mark "Picked Up" (Confirm order ID & start delivery)
   */
  const pickUpOrder = async (billImageUrl) => {
    const orderId = activeOrder?.orderMongoId || activeOrder?._id || activeOrder?.orderId;
    try {
      // confirmOrderId(orderId, confirmedOrderId, location, data)
      const response = await apiForOrder(activeOrder).confirmOrderId(
        orderId, 
        activeOrder.displayOrderId || orderId, 
        riderLocation || {},
        { billImageUrl }
      );
      
      if (response?.data?.success) {
        updateTripStatus('PICKED_UP');
        // toast.success('Order Collected! Heading to Drop-off');
      } else {
        throw new Error('Confirm order ID failed');
      }
    } catch (error) {
      toast.error('Error confirming pickup');
      throw error;
    }
  };

  /**
   * Mark "Reached Drop" (Arrival at customer)
   */
  const reachDrop = async () => {
    const orderId = activeOrder?.orderMongoId || activeOrder?._id || activeOrder?.orderId;
    try {
      const response = await apiForOrder(activeOrder).confirmReachedDrop(orderId);
      if (response?.data?.success) {
        updateTripStatus('REACHED_DROP');
        // toast.info('Arrived at Customer Location');
      } else {
        throw new Error('Confirm drop failed');
      }
    } catch (error) {
      toast.error('Failed to notify arrival');
      throw error;
    }
  };

  /**
   * Finalize Delivery with OTP Check
   */
  const completeDelivery = async (otp) => {
    const orderId = activeOrder?.orderMongoId || activeOrder?._id || activeOrder?.orderId;
    try {
      // 1. Verify OTP first
      const verifyRes = await apiForOrder(activeOrder).verifyDropOtp(orderId, otp);
      
      if (verifyRes?.data?.success) {
        let finalOrder = verifyRes.data?.data?.order || activeOrder;
        
        // 2. Mark as complete
        const completeRes = await apiForOrder(activeOrder).completeDelivery(orderId, { otp, rating: 5 });
        if (completeRes.data?.success && completeRes.data?.data?.order) {
          finalOrder = completeRes.data.data.order;
        } else {
          toast.error(completeRes.data?.message || 'Failed to complete delivery on server');
          throw new Error('Complete call failed');
        }
        
        // Update local order state so Summary Modal shows 'delivered' status
        if (finalOrder) setActiveOrder(tagOrder(finalOrder, activeOrder?.service));
        
        updateTripStatus('COMPLETED');
        // toast.success('Delivery Success!');
      } else {
        toast.error('Invalid OTP. Please check with customer.');
        throw new Error('Invalid OTP');
      }
    } catch (error) {
      console.error('Completion Error:', error);
      toast.error(error?.response?.data?.message || 'Verification failed');
      throw error;
    }
  };

  const resetTrip = () => {
    clearActiveOrder();
  };

  return {
    acceptOrder,
    reachPickup,
    pickUpOrder,
    reachDrop,
    completeDelivery,
    resetTrip,
  };
};

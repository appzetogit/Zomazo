import api from '@sp/services/api';

export const getCoupons = async (params = {}) => (await api.get('/admin/coupons', { params })).data;
export const getCoupon = async (id) => (await api.get(`/admin/coupons/${id}`)).data;
export const createCoupon = async (data) => (await api.post('/admin/coupons', data)).data;
export const updateCoupon = async (id, data) => (await api.put(`/admin/coupons/${id}`, data)).data;
export const toggleCouponStatus = async (id) => (await api.patch(`/admin/coupons/${id}/status`)).data;
export const deleteCoupon = async (id) => (await api.delete(`/admin/coupons/${id}`)).data;

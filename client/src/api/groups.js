import { apiClient } from './client';

export const groupsApi = {
  list:           ()         => apiClient.get('/groups'),
  get:            (id)       => apiClient.get(`/groups/${id}`),
  create:         (data)     => apiClient.post('/groups', data),
  delete:         (id)       => apiClient.delete(`/groups/${id}`, 
                                  { data: { confirm: true } }),
  transferAdmin:  (id, data) => apiClient.patch(`/groups/${id}/admin`, data),
  addMember:      (id, data) => apiClient.post(`/groups/${id}/members`, data),
  removeMember:   (id, uid)  => apiClient.delete(`/groups/${id}/members/${uid}`),
};

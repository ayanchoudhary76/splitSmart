import { apiClient } from './client';

export const expensesApi = {
  list:    (groupId, params) => 
             apiClient.get(`/groups/${groupId}/expenses`, { params }),
  get:     (groupId, id)    => 
             apiClient.get(`/groups/${groupId}/expenses/${id}`),
  create:  (groupId, data)  => 
             apiClient.post(`/groups/${groupId}/expenses`, data),
  delete:  (groupId, id)    => 
             apiClient.delete(`/groups/${groupId}/expenses/${id}`),
  balances:(groupId)        => 
             apiClient.get(`/groups/${groupId}/balances`),
  settle:  (groupId, data)  => 
             apiClient.post(`/groups/${groupId}/settlements`, data),
  settlements: (groupId)    => 
             apiClient.get(`/groups/${groupId}/settlements`),
};

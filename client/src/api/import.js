import { apiClient } from './client';

export const importApi = {
  preview: (groupId, formData) =>
             apiClient.post(`/import/${groupId}/preview`, formData, {
               headers: { 'Content-Type': 'multipart/form-data' }
             }),
  confirm: (groupId, data)     =>
             apiClient.post(`/import/${groupId}/confirm`, data),
  report:  (groupId, sessionId) =>
             apiClient.get(`/import/${groupId}/sessions/${sessionId}/report`, { responseType: 'text' }),
};

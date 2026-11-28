import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
})

// Ajoute le token (s'il existe) à chaque requête
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Token expiré ou compte désactivé : on déconnecte (sauf pour le login lui-même)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const estLogin = error.config?.url === '/auth/login'
    if (error.response?.status === 401 && !estLogin) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
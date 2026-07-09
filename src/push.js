// Web Push 订阅：申请通知权限 → 订阅浏览器推送服务 → 把订阅交给后端
import { fetchVapidPublicKey, savePushSubscription } from './api'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('这个浏览器不支持推送通知')
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') {
    throw new Error('通知权限没开，去浏览器设置里允许一下')
  }

  const reg = await navigator.serviceWorker.ready
  const { key } = await fetchVapidPublicKey()
  if (!key) throw new Error('服务端还没配置推送密钥')

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })
  }
  await savePushSubscription(sub.toJSON())
  return true
}

// 已授权过的设备静默续订（打开 App 时调用，保证订阅不因浏览器轮换而失效）
export async function resubscribeIfGranted() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    await enablePushNotifications()
  } catch {
    /* 静默失败，不打扰 */
  }
}

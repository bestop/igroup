// 微信订阅消息：在小程序后台申请模板后，把模板 ID 填到这里（最多 3 条同时请求）。
// 未配置时静默跳过，不影响主流程。
const SUBSCRIBE_TMPL_IDS = [
  // '模板ID1', // 例：拼单进度提醒（截单/付款提醒共用）
  // '模板ID2'  // 例：到货提货提醒
]

/**
 * 在按钮点击事件内同步调用，向用户申请订阅授权。
 * 用户拒绝不报错、不阻断。
 */
function requestSubscribe() {
  if (!SUBSCRIBE_TMPL_IDS.length) return Promise.resolve(false)
  return new Promise(resolve => {
    wx.requestSubscribeMessage({
      tmplIds: SUBSCRIBE_TMPL_IDS.slice(0, 3),
      complete: () => resolve(true)
    })
  })
}

module.exports = { requestSubscribe }

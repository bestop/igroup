// 云开发环境 ID。开通云开发后，在这里填入你的环境 ID（如 "linli-1g2h3j4k"）。
// 留空时使用云开发的默认环境（仅有一个环境时可用）。
const CLOUD_ENV = 'cloud1-d6g7nyq6f3a70af04'

App({
  globalData: {
    profile: null // 当前用户名片 { openid, nickname, avatar }
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库版本过低，无法使用云开发能力，请升级基础库')
      return
    }
    wx.cloud.init({
      env: CLOUD_ENV || undefined,
      traceUser: true
    })
  }
})

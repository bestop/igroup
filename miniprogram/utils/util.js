// 通用工具：金额（分）与时间处理

function pad(n) { return (n < 10 ? '0' : '') + n }

/** 分 -> 元字符串，如 2990 -> "29.90" */
function fen2yuan(fen) {
  fen = Math.round(Number(fen) || 0)
  return (fen / 100).toFixed(2)
}

/** 元输入字符串 -> 分整数，如 "29.9" -> 2990；非法返回 0 */
function yuanStrToFen(str) {
  const n = parseFloat(str)
  if (isNaN(n) || n < 0) return 0
  return Math.round(n * 100)
}

function formatDateTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 截单倒计时文案 */
function countdownText(deadline, now) {
  const diff = (deadline || 0) - (now || Date.now())
  if (diff <= 0) return '已截单'
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (d > 0) return `${d}天${h}小时${m}分`
  if (h > 0) return `${h}小时${m}分`
  return `${m}分${pad(s)}秒`
}

/** 回调式 API 转 Promise */
function p(fn, ctx) {
  return function (opts) {
    return new Promise((resolve, reject) => {
      fn.call(ctx, Object.assign({}, opts, { success: resolve, fail: reject }))
    })
  }
}

/** 上传本地临时图片到云存储，返回 fileID */
function uploadImage(tempPath, folder) {
  const match = (tempPath || '').match(/\.\w+$/)
  const ext = match ? match[0] : '.jpg'
  const cloudPath = `${folder}/${Date.now()}-${Math.floor(Math.random() * 100000)}${ext}`
  return p(wx.cloud.uploadFile)({ cloudPath, filePath: tempPath }).then(r => r.fileID)
}

/** 保存图片（fileID 或临时路径）到相册，处理权限拒绝 */
async function saveImageToAlbum(fileIDOrPath) {
  let path = fileIDOrPath
  if (/^cloud:\/\//.test(fileIDOrPath)) {
    const dl = await p(wx.cloud.downloadFile)({ fileID: fileIDOrPath })
    path = dl.tempFilePath
  }
  try {
    await p(wx.saveImageToPhotosAlbum)({ filePath: path })
    return true
  } catch (e) {
    if (e && /auth|deny|denied/i.test(e.errMsg || '')) {
      const res = await new Promise(resolve => {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存图片到相册',
          success: resolve,
          fail: resolve
        })
      })
      if (res && res.confirm) {
        p(wx.openSetting)({}).catch(() => {})
      }
    }
    return false
  }
}

/** 云函数调用通用包装：统一 toast 错误 */
function showError(msg) {
  wx.showToast({ title: msg || '操作失败', icon: 'none', duration: 2500 })
}

module.exports = {
  fen2yuan,
  yuanStrToFen,
  formatDateTime,
  formatDate,
  countdownText,
  p,
  uploadImage,
  saveImageToAlbum,
  showError,
  pad
}

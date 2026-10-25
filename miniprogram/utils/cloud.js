// 云函数调用统一入口：所有数据读写都走云函数，绕开数据库权限规则问题

// 把云开发常见底层错误翻译成可操作的提示
function friendlyErrMsg(err) {
  const text = `${(err && err.errMsg) || ''} ${(err && err.errCode) || ''}`
  if (/601034|没有权限/.test(text)) {
    return '云开发未开通或环境无效：请在开发者工具点「云开发」开通并创建环境，然后在 app.js 填写环境ID，重新编译'
  }
  if (/-404003|function.*not.*found|FUNCTION_NOT_FOUND/i.test(text)) {
    return '云函数 groupbuy 未部署：请右键 cloudfunctions/groupbuy → 上传并部署（云端安装依赖）'
  }
  return '网络异常，请重试'
}

function callCloud(action, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'groupbuy',
      data: Object.assign({ action }, data || {})
    }).then(res => {
      const r = res.result
      if (r && r.code === 0) {
        resolve(r.data)
      } else {
        let msg = (r && r.msg) || '请求失败，请重试'
        // 这两条报错只存在于旧版云函数（整包拆分版本之前的校验文案），提示重新部署
        if (/单价无效|总份数需为 1-999/.test(msg)) {
          msg += '；云函数版本过旧，请右键 cloudfunctions/groupbuy 重新「上传并部署」'
        }
        reject(new Error(msg))
      }
    }).catch(err => {
      reject(new Error(friendlyErrMsg(err)))
    })
  })
}

module.exports = { callCloud }

/**
 * 通知层：站内通知记录 + 订阅消息（尽力而为，失败静默）+ 云存储换链
 */
const { cloud, db, participantsOf } = require('./db')
const { TEMPLATES, MINI_STATE } = require('../config')

async function addNotification(gbId, receiverOpenid, type) {
  await db.collection('notifications').add({
    data: {
      group_buy_id: gbId,
      receiver_openid: receiverOpenid,
      type,
      sent_at: Date.now()
    }
  }).catch(() => {})
}

function buildSubData(thing1, thing2) {
  // thing 字段最长 20 字符
  return {
    thing1: { value: String(thing1 || '').slice(0, 20) },
    thing2: { value: String(thing2 || '').slice(0, 20) }
  }
}

/** 尽力发送订阅消息；未配置模板或发送失败均静默跳过 */
async function sendSub(touser, key, page, thing1, thing2) {
  const templateId = TEMPLATES[key]
  if (!templateId) return
  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId,
      page,
      data: buildSubData(thing1, thing2),
      miniprogramState: MINI_STATE
    })
  } catch (e) {
    console.warn('subscribe send skipped:', e.errCode || e.message)
  }
}

/** 通知拼单全部参与者：写通知记录 + 尽力发订阅消息 */
async function notifyAllParticipants(gb, type, subKey, thing2) {
  const ps = await participantsOf(gb._id)
  const openids = [...new Set(ps.map(p => p.user_openid))]
  await Promise.all(openids.map(o =>
    addNotification(gb._id, o, type).then(() =>
      sendSub(o, subKey, `pages/detail/detail?id=${gb._id}`, gb.product_name, thing2)
    )
  ))
  return openids.length
}

/** 云存储 fileID -> 临时链接映射（fileID 过期需要换链，非云文件原样跳过） */
async function tempUrlMap(fileIDs) {
  const ids = [...new Set((fileIDs || []).filter(x => x && /^cloud:\/\//.test(x)))]
  if (!ids.length) return {}
  const res = await cloud.getTempFileURL({ fileList: ids }).catch(() => ({ fileList: [] }))
  const map = {}
  ;(res.fileList || []).forEach(f => { if (f.fileID && f.tempFileURL) map[f.fileID] = f.tempFileURL })
  return map
}

module.exports = { addNotification, sendSub, notifyAllParticipants, tempUrlMap }

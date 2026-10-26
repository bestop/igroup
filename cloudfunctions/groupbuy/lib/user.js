/**
 * 用户名片读写
 */
const { db } = require('./db')

/**
 * 读取用户文档：优先 _id = openid 的确定性主键新格式；
 * 兼容旧"自动 _id + openid 字段"格式，命中后尽力迁移到新主键。
 */
async function getUser(openid) {
  const ref = db.collection('users').doc(openid)
  const direct = await ref.get().catch(() => null)
  if (direct && direct.data) return direct.data
  const legacy = await db.collection('users').where({ openid }).get().catch(() => ({ data: [] }))
  if (!legacy.data.length) return null
  const old = legacy.data[0]
  const migrated = Object.assign({}, old)
  delete migrated._id
  await ref.set({ data: migrated }).catch(() => {})  // 旧数据迁移，尽力而为
  return migrated
}

async function upsertUser(openid, patch) {
  const now = Date.now()
  const data = { updated_at: now }
  if (patch.nickname) data.nickname = patch.nickname
  if (patch.avatar) data.avatar = patch.avatar
  const exist = await getUser(openid)
  if (exist) {
    await db.collection('users').doc(openid).update({ data })
  } else {
    // _id 直接用 openid：并发首次创建时 set 幂等覆盖同一文档，
    // 消除原"先查后插"两请求同时见到空结果、各插一条的竞态
    const user = Object.assign({
      openid,
      nickname: `邻居${openid.slice(-4)}`,
      avatar: '',
      created_at: now
    }, data)
    try {
      await db.collection('users').doc(openid).set({ data: user })
    } catch (e) {
      await db.collection('users').doc(openid).update({ data }).catch(() => {})
    }
  }
}

module.exports = { getUser, upsertUser }

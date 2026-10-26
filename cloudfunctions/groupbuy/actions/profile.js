/**
 * 用户域：个人名片
 */
const { db } = require('../lib/db')
const { getUser, upsertUser } = require('../lib/user')

/** 获取/初始化当前用户名片 */
async function getProfile(_event, openid) {
  const exist = await getUser(openid)
  if (exist) return exist
  const now = Date.now()
  const user = {
    openid,
    nickname: `邻居${openid.slice(-4)}`,
    avatar: '',
    created_at: now,
    updated_at: now
  }
  // _id = openid，并发初始化时 set 幂等覆盖，不会产生重复名片
  await db.collection('users').doc(openid).set({ data: user }).catch(() => {})
  return user
}

/** 更新昵称头像 */
async function updateProfile(event, openid) {
  await upsertUser(openid, event)
  return { ok: true }
}

module.exports = { getProfile, updateProfile }

/**
 * 用户域：个人名片
 */
const { db } = require('../lib/db')
const { getUser, upsertUser } = require('../lib/user')

const NICKNAME_MAX = 20
const AVATAR_MAX = 128

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

/** 更新昵称头像：白名单字段 + 长度/格式校验，杜绝超长昵称与非法地址入库 */
async function updateProfile(event, openid) {
  const patch = {}

  // [...str] 按码点计数，emoji 昵称不会被误判超长
  const nickname = typeof event.nickname === 'string' ? event.nickname.trim() : ''
  if (!nickname) throw new Error('昵称不能为空')
  if ([...nickname].length > NICKNAME_MAX) throw new Error(`昵称不能超过 ${NICKNAME_MAX} 个字`)
  patch.nickname = nickname

  // 空串 = 本次不改头像（upsertUser 跳过空值），非空必须为合法云存储/网络地址
  const avatar = typeof event.avatar === 'string' ? event.avatar.trim() : ''
  if (avatar && (avatar.length > AVATAR_MAX || !/^(cloud:\/\/|https?:\/\/)/.test(avatar))) {
    throw new Error('头像地址无效，请重新选择头像')
  }
  if (avatar) patch.avatar = avatar

  await upsertUser(openid, patch)
  return { ok: true, profile: await getUser(openid) }
}

module.exports = { getProfile, updateProfile }

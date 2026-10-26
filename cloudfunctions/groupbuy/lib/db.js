/**
 * 数据库访问层：初始化 + 集合/查询基础工具
 * 全项目唯一调用 cloud.init 的位置，其他模块经由此文件共享 db 实例。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { assert } = require('./guards')

const readyCols = new Set()

async function ensureCol(name) {
  if (readyCols.has(name)) return
  try { await db.createCollection(name) } catch (e) { /* 已存在则忽略 */ }
  readyCols.add(name)
}

/**
 * 分页读取全部记录（服务端单次上限 1000 条，循环取完，避免超限时静默截断）。
 * orderBy 用于保证 skip 分页的稳定性，建议始终传入。
 */
async function fetchAll(col, where, orderBy) {
  const PAGE = 1000
  const out = []
  let skip = 0
  for (;;) {
    let q = db.collection(col).where(where)
    if (orderBy) q = q.orderBy(orderBy[0], orderBy[1])
    const res = await q.skip(skip).limit(PAGE).get()
    out.push(...res.data)
    if (res.data.length < PAGE) break
    skip += PAGE
  }
  return out
}

async function participantsOf(gbId) {
  return fetchAll('participants', { group_buy_id: gbId }, ['joined_at', 'asc'])
}

async function getGB(id) {
  assert(id, '缺少拼单ID')
  const res = await db.collection('groupbuys').doc(id).get().catch(() => null)
  assert(res && res.data, '拼单不存在或已被删除')
  return res.data
}

async function getParticipant(pid) {
  assert(pid, '缺少参与记录ID')
  const res = await db.collection('participants').doc(pid).get().catch(() => null)
  assert(res && res.data, '参与记录不存在')
  return res.data
}

module.exports = { cloud, db, _, ensureCol, fetchAll, participantsOf, getGB, getParticipant }

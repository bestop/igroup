/**
 * 定时截单：由 config.json 中的定时触发器调用（每 5 分钟）
 */
const { db, _, fetchAll } = require('./lib/db')
const { addNotification, sendSub } = require('./lib/notify')

async function autoCloseExpired() {
  const now = Date.now()
  const expired = await fetchAll('groupbuys', { status: 'open', deadline: _.lte(now) })
  let closed = 0
  for (const gb of expired) {
    const u = await db.collection('groupbuys')
      .where({ _id: gb._id, status: 'open' })
      .update({ data: { status: 'closed' } })
    if (u.stats && u.stats.updated > 0) {
      closed++
      await addNotification(gb._id, gb.initiator_openid, 'deadline')
      await sendSub(gb.initiator_openid, 'purchased', `pages/manage/manage?id=${gb._id}`,
        gb.product_name, '拼单已到截单时间，请查看收款并安排购买')
    }
  }
  return { checked: expired.length, closed }
}

module.exports = { autoCloseExpired }

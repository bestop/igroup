/**
 * 邻里拼单 - 唯一云函数 groupbuy（入口 / 路由）
 * 所有数据读写均通过本函数完成（云数据库默认权限"仅创建者可读写"下也能正常工作）。
 *
 * 两种调用方式：
 *  1. 小程序端 callFunction({ action, ...params }) -> action 路由
 *  2. 定时触发器（见 config.json）-> 自动截单，event.Type === 'Timer'
 *
 * 资金原则：本函数不触碰任何资金，只做记账 + 状态协同。
 *
 * 模块结构（按域拆分）：
 *  config.js              全局配置（订阅消息模板、集合清单）
 *  lib/guards.js          纯函数守卫：fail / assert / mustInitiator / assertActive
 *  lib/db.js              数据库访问层：cloud.init、fetchAll 分页取全、基础读取
 *  lib/notify.js          通知层：站内通知 + 订阅消息 + 云存储换链
 *  lib/user.js            用户名片：getUser / upsertUser（_id = openid）
 *  lib/normalize.js       创建/编辑拼单入参校验与规范化
 *  actions/profile.js     用户域：getProfile / updateProfile
 *  actions/groupbuy.js    拼单域：创建/编辑/详情/截单/购买/提货通知/完成/取消
 *  actions/participation.js 参与域：加入(事务防超卖)/移除/确认提货
 *  actions/payment.js     收款域：选方式/标记付款/确认/驳回/当面收款/提醒
 *  actions/lists.js       列表域：我的订单 / 我发起的 / 发现页
 *  timer.js               定时截单
 */
const cloud = require('wx-server-sdk')
const { ensureCol } = require('./lib/db')
const { COLS } = require('./config')
const { fail } = require('./lib/guards')
const { autoCloseExpired } = require('./timer')

// 23 个 action 按域聚合后平铺成路由表
const actions = Object.assign({},
  require('./actions/profile'),
  require('./actions/groupbuy'),
  require('./actions/participation'),
  require('./actions/payment'),
  require('./actions/lists')
)

exports.main = async (event = {}) => {
  // 定时触发器：每 5 分钟检查到期拼单并自动截单
  if (event.Type === 'Timer' || event.TriggerName) {
    try { return { code: 0, data: await autoCloseExpired() } }
    catch (e) { console.error('autoClose failed', e); return fail('自动截单失败：' + e.message) }
  }

  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('无用户身份，请从小程序端调用')
  await Promise.all(COLS.map(ensureCol))

  const fn = actions[event.action]
  if (!fn) return fail('未知的 action：' + event.action)
  try {
    const data = await fn(event, OPENID)
    return { code: 0, data }
  } catch (e) {
    console.error(`action ${event.action} failed:`, e)
    return fail(e.message || '服务异常，请稍后重试')
  }
}

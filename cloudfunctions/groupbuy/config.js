/**
 * 全局配置
 */
// 订阅消息配置（可选）
// 在小程序后台申请订阅模板后填入模板 ID，留空则跳过发送（不影响主流程）。
// 发送字段为 thing1/thing2，请按你申请的模板字段调整 buildSubData()。
const TEMPLATES = {
  payRemind: '',   // 付款提醒（发给未付款参与者）
  purchased: '',   // 已完成购买/待提货（发给所有参与者）
  arrival: '',     // 到货提货通知（发给所有参与者）
  cancel: ''       // 拼单取消（发给所有参与者）
}
const MINI_STATE = 'formal' // 体验版调试时改为 'trial'

// 首次调用时按需创建的集合
const COLS = ['users', 'groupbuys', 'participants', 'notifications']

module.exports = { TEMPLATES, MINI_STATE, COLS }

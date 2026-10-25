// 状态与文案枚举（与云函数中保持一致）

const GB_STATUS = {
  open:      { label: '拼单中', color: 'green' },
  closed:    { label: '已截单', color: 'orange' },
  purchased: { label: '待提货', color: 'blue' },
  completed: { label: '已完成', color: 'gray' },
  cancelled: { label: '已取消', color: 'gray' }
}

const PAY_STATUS = {
  unpaid:          { label: '待付款', color: 'gray' },
  paid_pending:    { label: '待确认', color: 'orange' },
  confirmed:       { label: '已确认', color: 'green' },
  cash_on_pickup:  { label: '当面支付', color: 'blue' }
}

const PAY_METHOD = {
  qr_code: '微信收款码',
  cash: '当面支付'
}

const FEE_BEARER = {
  split: '邻居均摊',
  initiator: '发起人承担',
  none: '不计入'
}

const STORE_PRESETS = ['山姆', '盒马', '开市客', '其他']
const UNIT_PRESETS = ['份', '箱', '袋', '瓶', '盒']

function gbStatus(status) { return GB_STATUS[status] || { label: status, color: 'gray' } }
function payStatus(status) { return PAY_STATUS[status] || { label: status, color: 'gray' } }

module.exports = {
  GB_STATUS,
  PAY_STATUS,
  PAY_METHOD,
  FEE_BEARER,
  STORE_PRESETS,
  UNIT_PRESETS,
  gbStatus,
  payStatus
}

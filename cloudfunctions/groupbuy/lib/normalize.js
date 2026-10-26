/**
 * 创建/编辑拼单入参的校验与规范化（金额单位：分）
 */
const { assert } = require('./guards')

function pay_fee_amount(v) {
  const n = Math.round(Number(v))
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** 校验并规范化创建/编辑拼单的公共字段 */
function normalizeBuyPayload(p) {
  assert(p.product_name && String(p.product_name).trim(), '请填写商品名称')
  const package_price = Math.round(Number(p.package_price))
  assert(Number.isInteger(package_price) && package_price > 0, '整包价格无效')
  const package_shares = Math.round(Number(p.package_shares))
  assert(Number.isInteger(package_shares) && package_shares >= 1 && package_shares <= 999, '每包拆分数量需为 1-999')
  const total_packages = Math.round(Number(p.total_packages)) || 1
  assert(Number.isInteger(total_packages) && total_packages >= 1 && total_packages <= 99, '总包数需为 1-99')
  const total_shares = package_shares * total_packages
  // 每份单价 = 整包价格 ÷ 每包拆分数量（四舍五入到分，尾差由发起人吸收）
  const unit_price = Math.round(package_price / package_shares)
  const deadline = Number(p.deadline)
  assert(deadline > Date.now() + 60000, '截单时间需晚于当前时间')
  const pay_qr_enabled = !!p.pay_qr_enabled
  const pay_cash_enabled = !!p.pay_cash_enabled
  assert(pay_qr_enabled || pay_cash_enabled, '至少开启一种收款方式')
  assert(!pay_qr_enabled || p.pay_qr_url, '开启收款码需上传收款码图片')
  const fee_bearer = ['split', 'initiator', 'none'].includes(p.fee_bearer) ? p.fee_bearer : 'split'
  const express_fee = pay_fee_amount(p.express_fee)
  const package_fee = pay_fee_amount(p.package_fee)
  // 均摊到每份：四舍五入到分（元两位小数），极小尾差由发起人吸收
  return {
    store: String(p.store || '其他').slice(0, 12),
    product_name: String(p.product_name).trim().slice(0, 30),
    product_image: p.product_image || '',
    unit: String(p.unit || '份').slice(0, 4),
    unit_price,
    total_shares,
    package_price,
    package_shares,
    total_packages,
    express_fee,
    package_fee,
    fee_bearer,
    fee_express_per_share: fee_bearer === 'split' ? Math.round(express_fee / total_shares) : 0,
    fee_package_per_share: fee_bearer === 'split' ? Math.round(package_fee / total_shares) : 0,
    deadline,
    pickup_location: String(p.pickup_location || '').trim().slice(0, 40) || '小区门口',
    remark: String(p.remark || '').slice(0, 200),
    pay_qr_enabled,
    pay_qr_url: p.pay_qr_url || '',
    pay_qr_note: String(p.pay_qr_note || '').slice(0, 60),
    pay_cash_enabled
  }
}

module.exports = { normalizeBuyPayload }

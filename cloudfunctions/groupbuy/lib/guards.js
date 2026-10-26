/**
 * 守卫与响应小工具（纯函数，无外部依赖）
 */
function fail(msg) { return { code: 1, msg } }

function assert(cond, msg) { if (!cond) throw new Error(msg) }

function mustInitiator(gb, openid) {
  assert(gb.initiator_openid === openid, '只有发起人可以进行此操作')
}

/** 进行中的拼单才允许支付相关变更（已取消/已完成均不可） */
function assertActive(gb) {
  assert(['open', 'closed', 'purchased'].includes(gb.status), '拼单已结束或已取消')
}

module.exports = { fail, assert, mustInitiator, assertActive }

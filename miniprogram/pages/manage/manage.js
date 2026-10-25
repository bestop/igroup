const { callCloud } = require('../../utils/cloud')
const util = require('../../utils/util')
const { requestSubscribe } = require('../../utils/subscribe')
const C = require('../../utils/const')

Page({
  data: {
    id: '',
    gb: null,
    statusView: null,
    countdown: '',
    participants: [],
    summary: null,
    loading: true,
    acting: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '' })
    if (!this.data.id) {
      util.showError('缺少拼单ID')
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 1200)
      return
    }
    this.fetch()
    this.timer = setInterval(() => {
      if (this.data.gb && this.data.gb.status === 'open') {
        this.setData({ countdown: util.countdownText(this.data.gb.deadline) })
      }
    }, 1000)
  },

  onUnload() { clearInterval(this.timer) },
  onHide() { clearInterval(this.timer) },
  onShow() { if (this.data.gb) this.fetch(true) },
  onPullDownRefresh() {
    this.fetch(true).finally(() => wx.stopPullDownRefresh())
  },

  async fetch(silent) {
    if (!silent) this.setData({ loading: true })
    try {
      const res = await callCloud('getGroupBuy', { id: this.data.id })
      const gb = res.group_buy
      const ps = res.participants
      if (!res.is_initiator) {
        this.setData({ loading: false })
        util.showError('只有发起人可以查看此页')
        setTimeout(() => wx.navigateBack(), 1200)
        return
      }
      const sumBy = st => ps.filter(p => p.pay_status === st)
        .reduce((s, p) => s + (p.amount_due || 0), 0)
      const totalDue = ps.reduce((s, p) => s + (p.amount_due || 0), 0)
      const confirmedAmount = sumBy('confirmed')
      this.setData({
        gb,
        statusView: C.gbStatus(gb.status),
        countdown: gb.status === 'open' ? util.countdownText(gb.deadline) : '',
        summary: {
          total_text: util.fen2yuan(totalDue),
          confirmed_text: util.fen2yuan(confirmedAmount),
          pending_text: util.fen2yuan(sumBy('paid_pending')),
          unpaid_count: ps.filter(p => p.pay_status === 'unpaid').length,
          cash_count: ps.filter(p => p.pay_status === 'cash_on_pickup').length,
          pending_count: ps.filter(p => p.pay_status === 'paid_pending').length,
          picked_count: ps.filter(p => p.pickup_status === 'picked_up').length,
          neighbor_count: ps.filter(p => !p.is_initiator_row).length,
          confirmed_pct: totalDue ? Math.round((confirmedAmount / totalDue) * 100) : 0,
          deadline_text: util.formatDateTime(gb.deadline)
        },
        participants: ps.map(p => this.decorateRow(p, gb)),
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      util.showError(e.message)
    }
  },

  decorateRow(p, gb) {
    // 团长自留份数的合成行：仅展示，不参与收款与提货操作
    if (p.is_initiator_row) {
      return {
        _id: p._id,
        is_initiator_row: true,
        nickname: p.nickname,
        avatar_url: p.avatar_url,
        shares: p.shares,
        unit: gb.unit,
        amount_text: '',
        pay_method_text: '',
        pay_status: null,
        pay_view: { label: '团长自留', color: 'gray' },
        payment_note: '',
        joined_text: '',
        pickup_text: '',
        picked_up: false,
        can_confirm: false,
        can_reject: false,
        can_remind: false,
        can_cash: false,
        has_actions: false
      }
    }
    const active = ['open', 'closed', 'purchased'].includes(gb.status)
    // cash_on_pickup 随时可当面收款；unpaid 仅在提货阶段允许"提货时已收现金"
    const canCash = p.pay_status === 'cash_on_pickup'
      ? active
      : (p.pay_status === 'unpaid' && gb.status === 'purchased')
    return {
      _id: p._id,
      nickname: p.nickname,
      avatar_url: p.avatar_url,
      shares: p.shares,
      unit: gb.unit,
      amount_text: util.fen2yuan(p.amount_due),
      pay_method_text: p.pay_method ? C.PAY_METHOD[p.pay_method] : '未选择方式',
      pay_status: p.pay_status,
      pay_view: C.payStatus(p.pay_status),
      payment_note: p.payment_note || '',
      joined_text: util.formatDateTime(p.joined_at),
      pickup_text: p.pickup_status === 'picked_up' ? '已提货' : '未提货',
      picked_up: p.pickup_status === 'picked_up',
      can_confirm: active && p.pay_status === 'paid_pending',
      can_reject: active && p.pay_status === 'paid_pending',
      can_remind: active && p.pay_status === 'unpaid' && ['open', 'closed'].includes(gb.status),
      can_cash: canCash,
      can_remove: gb.status === 'open',
      has_actions: active && (canCash || p.pay_status === 'paid_pending' ||
        (p.pay_status === 'unpaid' && ['open', 'closed'].includes(gb.status)) || gb.status === 'open')
    }
  },

  /** 弹窗确认后执行，统一处理 loading 与异常 */
  confirmThen(title, content, fn, confirmColor) {
    wx.showModal({
      title,
      content,
      confirmColor: confirmColor || '#FF4D4F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        fn().then(r => {
          wx.hideLoading()
          if (r && r.toast) wx.showToast({ title: r.toast, icon: r.icon || 'success' })
          this.fetch(true)
        }).catch(e => {
          wx.hideLoading()
          util.showError(e.message)
        })
      }
    })
  },

  /* ---------- 生命周期操作 ---------- */

  /** 编辑拼单：复用发起页表单（仅"拼单中"） */
  onEdit() {
    wx.navigateTo({ url: `/pages/create/create?id=${this.data.id}` })
  },

  /** 截单：先取未付款统计 -> 弹窗确认（不强制阻断） -> 执行截单 */
  async onClose() {
    if (this.data.acting) return
    try {
      const stats = await callCloud('closeGroupBuy', { group_buy_id: this.data.id })
      if (stats.unpaid_count > 0) {
        this.confirmThen('截单确认',
          `有 ${stats.unpaid_count} 人未确认付款（含当面支付 ${stats.cash_count} 人），是否仍截单？`,
          () => this.doClose())
      } else {
        this.confirmThen('截单确认', '截单后邻居将无法再加入，确认截单？', () => this.doClose())
      }
    } catch (e) {
      util.showError(e.message)
    }
  },

  async doClose() {
    if (this.data.acting) return
    this.setData({ acting: true })
    try {
      await callCloud('closeGroupBuy', { group_buy_id: this.data.id, force: true })
      wx.showToast({ title: '已截单', icon: 'success' })
      this.fetch(true)
    } catch (e) {
      util.showError(e.message)
    } finally {
      this.setData({ acting: false })
    }
  },

  /** 已完成购买 -> 待提货，通知所有参与者 */
  onPurchased() {
    this.confirmThen('完成购买', '确认你已完成购买？系统将通知所有参与的邻居。', async () => {
      requestSubscribe()
      const r = await callCloud('markPurchased', { group_buy_id: this.data.id })
      return { toast: `已通知 ${r.notified} 位邻居` }
    })
  },

  /** 通知提货 */
  onNotifyPickup() {
    this.confirmThen('通知提货',
      `将向所有参与者推送提货通知（到 ${this.data.gb.pickup_location} 提货），确认发送？`,
      async () => {
        requestSubscribe()
        const r = await callCloud('notifyPickup', { group_buy_id: this.data.id })
        return { toast: `已通知 ${r.notified} 位邻居` }
      })
  },

  /** 手动完成拼单 */
  onComplete() {
    this.confirmThen('完成拼单', '确认本次拼单已全部完成？', async () => {
      await callCloud('completeGroupBuy', { group_buy_id: this.data.id })
      return { toast: '拼单已完成' }
    })
  },

  /** 取消拼单 */
  onCancel() {
    this.confirmThen('取消拼单',
      '取消后无法恢复并通知所有参与者，已付款者将提示线下退款。确认取消？',
      async () => {
        const r = await callCloud('cancelGroupBuy', { group_buy_id: this.data.id })
        return { toast: `已取消并通知 ${r.notified} 人`, icon: 'none' }
      }, '#E64340')
  },

  /* ---------- 收款管理操作 ---------- */

  onConfirmAll() {
    this.confirmThen('批量确认', '确认已收到全部"待确认"记录的转账款项？', async () => {
      const r = await callCloud('confirmAllPay', { group_buy_id: this.data.id })
      return { toast: `已确认 ${r.updated} 笔收款` }
    })
  },

  rowAction(e) {
    const { pid, act } = e.currentTarget.dataset
    if (this.data.acting) return
    const tips = {
      confirmPay: ['确认收款', '确认已收到该邻居的转账？'],
      rejectPay: ['未收到款', '将该记录退回"待付款"？'],
      confirmCash: ['当面收款', '确认已当面收到该邻居的钱款？'],
      remindPay: ['提醒付款', '将向该邻居发送付款提醒（24小时内仅一次）。']
    }
    const t = tips[act]
    if (!t) return
    this.confirmThen(t[0], t[1], async () => {
      if (act === 'remindPay') requestSubscribe()
      await callCloud(act, { participant_id: pid })
      return { toast: '操作成功' }
    })
  },

  /** 移除参与者（仅"拼单中"），已付款者提示线下退款 */
  onRemove(e) {
    const pid = e.currentTarget.dataset.pid
    if (this.data.acting) return
    const row = this.data.participants.find(x => x._id === pid)
    if (!row) return
    const paid = ['paid_pending', 'confirmed'].includes(row.pay_status)
    this.confirmThen('移除参与者',
      paid
        ? `${row.nickname} 已付款 ¥${row.amount_text}，移除后请线下退款。确认移除？`
        : `移除 ${row.nickname} 后，其 ${row.shares} ${row.unit} 份额将释放给其他邻居。确认移除？`,
      async () => {
        await callCloud('removeParticipant', { participant_id: pid })
        return { toast: '已移除' }
      }, '#E64340')
  }
})

const { callCloud } = require('../../utils/cloud')
const util = require('../../utils/util')
const { requestSubscribe } = require('../../utils/subscribe')
const C = require('../../utils/const')

Page({
  data: {
    orders: [],
    loading: true,
    actingId: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      const orders = await callCloud('getMyOrders')
      this.setData({
        orders: (orders || []).map(o => this.decorate(o)),
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      util.showError(e.message)
    }
  },

  decorate(order) {
    const p = order.participant
    const g = order.group_buy
    return {
      pid: p._id,
      gb_id: g._id,
      product_name: g.product_name,
      store: g.store,
      unit: g.unit,
      image_url: g.product_image_url,
      gb_status: g.status,
      gb_status_view: C.gbStatus(g.status),
      pickup_location: g.pickup_location,
      shares: p.shares,
      amount_text: util.fen2yuan(p.amount_due),
      pay_method_text: p.pay_method ? C.PAY_METHOD[p.pay_method] : '',
      pay_status: p.pay_status,
      pay_status_view: C.payStatus(p.pay_status),
      pickup_status: p.pickup_status,
      gb_open: g.status === 'open',
      can_pay: p.pay_status === 'unpaid' && ['open', 'closed'].includes(g.status),
      can_pickup: g.status === 'purchased' && p.pickup_status === 'pending',
      picked_up: p.pickup_status === 'picked_up',
      refund_hint: g.status === 'cancelled' && ['paid_pending', 'confirmed'].includes(p.pay_status)
    }
  },

  goPay(e) {
    wx.navigateTo({ url: `/pages/pay/pay?id=${e.currentTarget.dataset.id}` })
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` })
  },

  async onConfirmPickup(e) {
    const pid = e.currentTarget.dataset.pid
    if (this.data.actingId) return
    const that = this
    wx.showModal({
      title: '确认提货',
      content: '确认已从发起人处拿到货品？',
      success: async res => {
        if (!res.confirm) return
        that.setData({ actingId: pid })
        try {
          requestSubscribe()
          await callCloud('confirmPickup', { participant_id: pid })
          wx.showToast({ title: '已确认提货', icon: 'success' })
          that.refresh()
        } catch (err) {
          util.showError(err.message)
        } finally {
          that.setData({ actingId: '' })
        }
      }
    })
  }
})

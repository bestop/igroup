const { callCloud } = require('../../utils/cloud')
const util = require('../../utils/util')
const C = require('../../utils/const')

Page({
  data: {
    tab: 'joined', // joined: 我参与的 | created: 我发起的
    joined: [],
    created: [],
    profile: null,
    now: Date.now(),
    loading: true
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.refresh()
    // 列表里的截单倒计时每 30 秒刷新一次
    clearInterval(this.timer)
    this.timer = setInterval(() => {
      this.setData({ now: Date.now() })
    }, 30000)
  },

  onUnload() { clearInterval(this.timer) },
  onHide() { clearInterval(this.timer) },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      const [profile, orders, created] = await Promise.all([
        callCloud('getProfile'),
        callCloud('getMyOrders'),
        callCloud('getMyCreated')
      ])
      const profileView = this.decorateProfile(profile)
      this.setData({
        profile: profileView,
        joined: (orders || []).map(o => this.decorateJoined(o)),
        created: (created || []).map(g => this.decorateCreated(g)),
        now: Date.now(),
        loading: false
      })
      wx.setStorageSync('profile', profileView)
      getApp().globalData.profile = profileView
    } catch (e) {
      this.setData({ loading: false })
      util.showError(e.message)
    }
  },

  decorateProfile(profile) {
    return { nickname: profile.nickname, avatar: profile.avatar || '' }
  },

  decorateJoined(order) {
    return {
      pid: order.participant._id,
      shares: order.participant.shares,
      amount_due_text: util.fen2yuan(order.participant.amount_due),
      pay_status: order.participant.pay_status,
      pay_status_view: C.payStatus(order.participant.pay_status),
      gb_id: order.group_buy._id,
      product_name: order.group_buy.product_name,
      store: order.group_buy.store,
      unit: order.group_buy.unit,
      gb_status_view: C.gbStatus(order.group_buy.status),
      gb_status: order.group_buy.status,
      image_url: order.group_buy.product_image_url,
      deadline: order.group_buy.deadline,
      deadline_text: util.formatDateTime(order.group_buy.deadline),
      pay_qr_enabled: order.group_buy.pay_qr_enabled,
      pay_cash_enabled: order.group_buy.pay_cash_enabled
    }
  },

  decorateCreated(g) {
    return {
      id: g._id,
      product_name: g.product_name,
      store: g.store,
      unit: g.unit,
      unit_price_text: util.fen2yuan(g.unit_price),
      total_shares: g.total_shares,
      sold_shares: g.sold_shares,
      participant_count: g.participant_count,
      confirmed_text: util.fen2yuan(g.confirmed_amount),
      pending_text: util.fen2yuan(g.pending_amount),
      unpaid_count: g.unpaid_count,
      cash_count: g.cash_count,
      status: g.status,
      status_view: C.gbStatus(g.status),
      image_url: g.product_image_url,
      deadline: g.deadline,
      deadline_text: util.formatDateTime(g.deadline)
    }
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' })
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` })
  },

  goManage(e) {
    wx.navigateTo({ url: `/pages/manage/manage?id=${e.currentTarget.dataset.id}` })
  }
})

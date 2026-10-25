const { callCloud } = require('../../utils/cloud')
const util = require('../../utils/util')
const { requestSubscribe } = require('../../utils/subscribe')
const C = require('../../utils/const')

Page({
  data: {
    id: '',
    gb: null,
    participants: [],
    myParticipant: null,
    isInitiator: false,
    remainingShares: 0,
    progressPct: 0,
    perShareText: '',
    deadlineText: '',
    countdown: '',
    // 加入面板
    joinShares: 1,
    joinAmountText: '0.00',
    nickname: '',
    avatar: '',
    avatarFileID: '',
    joining: false,
    loading: true
  },

  onLoad(options) {
    const profile = wx.getStorageSync('profile') || getApp().globalData.profile || {}
    this.setData({
      id: options.id || '',
      nickname: profile.nickname || '',
      avatar: profile.avatar || '',
      avatarFileID: /^cloud:\/\//.test(profile.avatar || '') ? profile.avatar : ''
    })
    if (!this.data.id) {
      util.showError('拼单不存在')
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 1200)
      return
    }
    this.fetch()
    // 截单倒计时每秒刷新
    this.timer = setInterval(() => {
      if (this.data.gb && this.data.gb.status === 'open') {
        this.setData({ countdown: util.countdownText(this.data.gb.deadline) })
      }
    }, 1000)
  },

  onUnload() { clearInterval(this.timer) },
  onHide() { clearInterval(this.timer) },
  onShow() {
    if (this.data.id && this.data.gb) this.fetch(true)
    // 重新进入页面时恢复秒级倒计时
    clearInterval(this.timer)
    this.timer = setInterval(() => {
      if (this.data.gb && this.data.gb.status === 'open') {
        this.setData({ countdown: util.countdownText(this.data.gb.deadline) })
      }
    }, 1000)
  },

  onPullDownRefresh() {
    this.fetch(true).finally(() => wx.stopPullDownRefresh())
  },

  async fetch(silent) {
    if (!silent) this.setData({ loading: true })
    try {
      const res = await callCloud('getGroupBuy', { id: this.data.id })
      const gb = res.group_buy
      const remaining = Math.max(0, gb.total_shares - gb.sold_shares)
      const perShareFen = gb.unit_price + (gb.fee_express_per_share || 0) + (gb.fee_package_per_share || 0)
      const joinShares = Math.min(this.data.joinShares || 1, Math.max(remaining, 1))
      const mine = res.my_participant
      const canJoin = !res.is_initiator && !mine && gb.status === 'open' && remaining > 0
      this.setData({
        gb,
        participants: res.participants.map(p => Object.assign({}, p, {
          joinedText: util.formatDateTime(p.joined_at)
        })),
        myParticipant: mine,
        isInitiator: res.is_initiator,
        statusView: C.gbStatus(gb.status),
        packagePriceText: gb.package_price ? util.fen2yuan(gb.package_price) : '',
        myAmountText: mine ? util.fen2yuan(mine.amount_due) : '',
        myPayView: mine ? C.payStatus(mine.pay_status) : null,
        feeExpressText: util.fen2yuan(gb.fee_express_per_share || 0),
        feePackageText: util.fen2yuan(gb.fee_package_per_share || 0),
        remainingShares: remaining,
        progressPct: gb.total_shares ? Math.min(100, Math.round((gb.sold_shares / gb.total_shares) * 100)) : 0,
        perShareText: util.fen2yuan(perShareFen),
        deadlineText: util.formatDateTime(gb.deadline),
        countdown: gb.status === 'open' ? util.countdownText(gb.deadline) : '',
        joinShares,
        joinAmountText: util.fen2yuan(joinShares * perShareFen),
        canJoin,
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      util.showError(e.message)
    }
  },

  /* ---------- 份额选择 ---------- */
  onNickname(e) {
    this.setData({ nickname: e.detail.value })
  },

  onMinus() {
    if (this.data.joinShares <= 1) return
    this.changeShares(this.data.joinShares - 1)
  },

  onPlus() {
    if (this.data.joinShares >= this.data.remainingShares) return
    this.changeShares(this.data.joinShares + 1)
  },

  changeShares(n) {
    const gb = this.data.gb
    const perShareFen = gb.unit_price + (gb.fee_express_per_share || 0) + (gb.fee_package_per_share || 0)
    this.setData({
      joinShares: n,
      joinAmountText: util.fen2yuan(n * perShareFen)
    })
  },

  /* ---------- 加入拼单 ---------- */
  onChooseAvatar(e) {
    const temp = e.detail.avatarUrl
    util.uploadImage(temp, 'avatars').then(fileID => {
      this.setData({ avatar: temp, avatarFileID: fileID })
    }).catch(() => {
      this.setData({ avatar: temp, avatarFileID: '' })
      util.showError('头像上传失败，可继续加入')
    })
  },

  async onJoin() {
    if (this.data.joining) return
    const d = this.data
    if (!d.nickname.trim()) return util.showError('请填写昵称，方便团长核对')
    if (d.remainingShares < 1) return util.showError('手慢了，份数已拼完')
    this.setData({ joining: true })
    wx.showLoading({ title: '加入中', mask: true })
    try {
      requestSubscribe()
      await callCloud('joinGroupBuy', {
        id: d.id,
        shares: d.joinShares,
        nickname: d.nickname.trim(),
        avatar: d.avatarFileID
      })
      wx.hideLoading()
      wx.showToast({ title: '加入成功', icon: 'success' })
      // 进入支付引导页
      wx.navigateTo({ url: `/pages/pay/pay?id=${d.id}` })
    } catch (e) {
      wx.hideLoading()
      util.showError(e.message)
    } finally {
      this.setData({ joining: false })
    }
  },

  /* ---------- 其他 ---------- */
  goPay() {
    wx.navigateTo({ url: `/pages/pay/pay?id=${this.data.id}` })
  },

  goManage() {
    wx.navigateTo({ url: `/pages/manage/manage?id=${this.data.id}` })
  },

  copyInfo() {
    const gb = this.data.gb
    const perShare = this.data.perShareText
    const text = `【邻里拼单】${gb.store}${gb.product_name}拼单\n¥${perShare}/${gb.unit}${gb.fee_bearer === 'split' ? '（含分摊）' : ''}，还剩 ${this.data.remainingShares} ${gb.unit}\n截单：${this.data.deadlineText}\n提货：${gb.pickup_location}\n在微信搜索小程序「邻里拼单」，点开分享卡片即可加入`
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制，可粘贴到群聊', icon: 'none' })
    })
  },

  onShareAppMessage() {
    const gb = this.data.gb
    const perShare = this.data.perShareText
    return {
      title: `${gb.store}${gb.product_name}拼单｜¥${perShare}/${gb.unit}｜剩${this.data.remainingShares}${gb.unit}`,
      path: `/pages/detail/detail?id=${gb._id}`,
      imageUrl: gb.product_image_url || ''
    }
  },

  onShareTimeline() {
    const gb = this.data.gb
    return {
      title: `${gb.store}${gb.product_name}拼单｜¥${this.data.perShareText}/${gb.unit}｜剩${this.data.remainingShares}${gb.unit}`,
      query: `id=${gb._id}`
    }
  }
})

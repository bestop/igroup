const { callCloud } = require('../../utils/cloud')
const util = require('../../utils/util')
const { requestSubscribe } = require('../../utils/subscribe')
const C = require('../../utils/const')

Page({
  data: {
    id: '',
    gb: null,
    p: null, // 我的参与记录
    payView: null,
    statusView: null,
    // 明细
    shares: 0,
    goodsText: '0.00',      // 份额 × 商品单价
    expressText: '0.00',    // 分摊快递费
    packageText: '0.00',    // 分摊包装费
    totalText: '0.00',
    paymentNote: '',
    saving: false,
    acting: false,
    activeMethod: '', // 'qr' | 'cash'，方式 Tab 当前项
    loading: true
  },

  onLoad(options) {
    this.setData({ id: options.id || '' })
    if (!this.data.id) {
      util.showError('缺少拼单ID')
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 1200)
      return
    }
    this.fetch()
  },

  onShow() { if (this.data.gb) this.fetch(true) },
  onPullDownRefresh() {
    this.fetch(true).finally(() => wx.stopPullDownRefresh())
  },

  async fetch(silent) {
    if (!silent) this.setData({ loading: true })
    try {
      const res = await callCloud('getGroupBuy', { id: this.data.id })
      const gb = res.group_buy
      const mine = res.my_participant
      if (!mine) {
        this.setData({ gb, p: null, loading: false })
        return
      }
      const shares = mine.shares
      const goods = shares * gb.unit_price
      const express = shares * (gb.fee_express_per_share || 0)
      const pack = shares * (gb.fee_package_per_share || 0)
      this.setData({
        gb,
        p: mine,
        payView: C.payStatus(mine.pay_status),
        statusView: C.gbStatus(gb.status),
        shares,
        perSharePriceText: util.fen2yuan(gb.unit_price),
        paidAtText: mine.paid_at ? util.formatDateTime(mine.paid_at) : '',
        goodsText: util.fen2yuan(goods),
        expressText: util.fen2yuan(express),
        packageText: util.fen2yuan(pack),
        totalText: util.fen2yuan(mine.amount_due),
        // 默认选中收款码方式（未开启则当面支付），仅在首次进入时设定
        activeMethod: this.data.activeMethod || (gb.pay_qr_enabled ? 'qr' : 'cash'),
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      util.showError(e.message)
    }
  },

  onNote(e) { this.setData({ paymentNote: e.detail.value }) },

  /** 切换支付方式 Tab */
  onMethod(e) {
    this.setData({ activeMethod: e.currentTarget.dataset.m })
  },

  goDetail() {
    wx.navigateTo({ url: `/pages/detail/detail?id=${this.data.id}` })
  },

  /** 选择当面支付 */
  async onChooseCash() {
    if (this.data.acting) return
    const that = this
    wx.showModal({
      title: '选择当面支付',
      content: '确认提货时当面支付给发起人？确认后无需线上转账。',
      success: async res => {
        if (!res.confirm) return
        that.setData({ acting: true })
        try {
          await callCloud('choosePayMethod', {
            participant_id: that.data.p._id,
            method: 'cash'
          })
          wx.showToast({ title: '已选择当面支付', icon: 'success' })
          await that.fetch(true)
        } catch (e) {
          util.showError(e.message)
        } finally {
          that.setData({ acting: false })
        }
      }
    })
  },

  /** 扫码转账后，点击"我已付款" */
  async onMarkPaid() {
    if (this.data.acting) return
    const d = this.data
    if (!d.gb.pay_qr_enabled) return util.showError('发起人未开启收款码支付')
    requestSubscribe()
    this.setData({ acting: true })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      await callCloud('markPaid', {
        participant_id: d.p._id,
        payment_note: d.paymentNote.trim()
      })
      wx.hideLoading()
      wx.showToast({ title: '已通知发起人确认收款', icon: 'success', duration: 2500 })
      await this.fetch(true)
    } catch (e) {
      wx.hideLoading()
      util.showError(e.message)
    } finally {
      this.setData({ acting: false })
    }
  },

  /** 长按识别之外的显式入口：预览大图（可长按识别/保存） */
  previewQr() {
    const url = this.data.gb.pay_qr_temp_url
    if (!url) return
    wx.previewImage({ urls: [url] })
  },

  /** 保存收款码到相册 */
  async onSaveQr() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const ok = await util.saveImageToAlbum(this.data.gb.pay_qr_url)
      if (ok) wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e) {
      util.showError('保存失败，请长按二维码识别')
    } finally {
      this.setData({ saving: false })
    }
  }
})

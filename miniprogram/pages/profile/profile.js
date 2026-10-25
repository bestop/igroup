const { callCloud } = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    profile: null,
    editing: false,
    nickname: '',
    avatar: '',
    avatarFileID: '',
    joinedCount: 0,
    createdCount: 0,
    saving: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    this.refresh()
  },

  async refresh() {
    try {
      const [profile, orders, created] = await Promise.all([
        callCloud('getProfile'),
        callCloud('getMyOrders'),
        callCloud('getMyCreated')
      ])
      const profileView = { nickname: profile.nickname, avatar: profile.avatar || '' }
      this.setData({
        profile: profileView,
        nickname: profileView.nickname,
        avatar: profileView.avatar,
        avatarFileID: /^cloud:\/\//.test(profileView.avatar) ? profileView.avatar : '',
        editing: false,
        joinedCount: (orders || []).length,
        createdCount: (created || []).length
      })
      wx.setStorageSync('profile', profileView)
      getApp().globalData.profile = profileView
    } catch (e) {
      util.showError(e.message)
    }
  },

  toggleEdit() {
    this.setData({ editing: !this.data.editing })
  },

  onNickname(e) { this.setData({ nickname: e.detail.value }) },

  onChooseAvatar(e) {
    const temp = e.detail.avatarUrl
    util.uploadImage(temp, 'avatars').then(fileID => {
      this.setData({ avatar: temp, avatarFileID: fileID })
    }).catch(() => {
      this.setData({ avatar: temp, avatarFileID: '' })
      util.showError('头像上传失败，请重试')
    })
  },

  async saveProfile() {
    if (this.data.saving) return
    if (!this.data.nickname.trim()) return util.showError('昵称不能为空')
    this.setData({ saving: true })
    try {
      await callCloud('updateProfile', {
        nickname: this.data.nickname.trim(),
        avatar: this.data.avatarFileID
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      this.refresh()
    } catch (e) {
      util.showError(e.message)
    } finally {
      this.setData({ saving: false })
    }
  },

  goOrders() { wx.switchTab({ url: '/pages/orders/orders' }) },
  goIndex() { wx.switchTab({ url: '/pages/index/index' }) },

  onAbout() {
    wx.showModal({
      title: '资金说明',
      content: '邻里拼单不经手任何资金。付款直接通过发起人的个人收款码或提货时当面支付完成，小程序只负责记录份数、金额与收款状态。',
      showCancel: false,
      confirmText: '我知道了'
    })
  },

  onShareAppMessage() {
    return {
      title: '邻里拼单｜和邻居一起拼，更省钱',
      path: '/pages/discover/discover'
    }
  }
})

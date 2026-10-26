const { callCloud } = require('../../utils/cloud')
const util = require('../../utils/util')
const { requestSubscribe } = require('../../utils/subscribe')
const C = require('../../utils/const')

Page({
  data: {
    stores: C.STORE_PRESETS,
    storeIndex: 0,
    customStore: '',
    productName: '',
    productImage: '',   // 本地临时路径，用于展示
    productImageID: '', // 云存储 fileID
    packagePriceYuan: '',
    packageShares: '',
    totalPackages: '1',
    myShares: '0',
    units: C.UNIT_PRESETS,
    unitIndex: 0,
    expressEnabled: false,
    expressYuan: '',
    packageEnabled: false,
    packageYuan: '',
    bearers: [
      { k: 'split', label: '邻居均摊' },
      { k: 'initiator', label: '发起人承担' },
      { k: 'none', label: '不计入' }
    ],
    bearerIndex: 0,
    date: '',
    time: '20:00',
    pickupLocation: '小区门口',
    remark: '',
    qrEnabled: true,
    qrImage: '',
    qrFileID: '',
    qrNote: '请转账后备注拼单昵称，方便核对',
    cashEnabled: true,
    nickname: '',
    avatar: '',
    avatarFileID: '',
    avatarUploading: false,
    productUploading: false,
    qrUploading: false,
    todayStr: '',
    editId: '',
    editing: false,
    submitting: false
  },

  onLoad(options) {
    const now = new Date()
    const profile = wx.getStorageSync('profile') || getApp().globalData.profile || {}
    this.setData({
      todayStr: util.formatDate(now.getTime()),
      date: util.formatDate(now.getTime() + 86400000),
      nickname: profile.nickname || '',
      avatar: profile.avatar || '',
      avatarFileID: /^cloud:\/\//.test(profile.avatar || '') ? profile.avatar : ''
    })
    // 带 id 进入 = 编辑团长已发出的拼单（仅"拼单中"可编辑）
    if (options && options.id) {
      this.setData({ editId: options.id, editing: true })
      wx.setNavigationBarTitle({ title: '编辑拼单' })
      this.loadForEdit(options.id)
      return
    }
    this.recalcPreview()
  },

  /** 编辑模式：拉取拼单并回填表单 */
  async loadForEdit(id) {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      const res = await callCloud('getGroupBuy', { id })
      const gb = res.group_buy
      if (!res.is_initiator) {
        wx.hideLoading()
        util.showError('只有发起人可以编辑拼单')
        setTimeout(() => wx.navigateBack(), 1200)
        return
      }
      if (gb.status !== 'open') {
        wx.hideLoading()
        util.showError('拼单已截单，不能再编辑')
        setTimeout(() => wx.navigateBack(), 1200)
        return
      }
      const dl = new Date(gb.deadline)
      const storeIdx = this.data.stores.indexOf(gb.store)
      // 旧版（单价模式）拼单换算为整包模式：整包价=每份价、拆分数=1、包数=总份数
      const pkgPrice = gb.package_price || gb.unit_price
      const pkgShares = gb.package_shares || 1
      const pkgs = gb.total_packages || gb.total_shares
      this.setData({
        productName: gb.product_name,
        productImage: gb.product_image_url || '',
        productImageID: gb.product_image || '',
        packagePriceYuan: util.fen2yuan(pkgPrice),
        packageShares: String(pkgShares),
        totalPackages: String(pkgs),
        myShares: String(gb.initiator_shares || 0),
        storeIndex: storeIdx >= 0 ? storeIdx : this.data.stores.length - 1,
        customStore: storeIdx >= 0 ? '' : gb.store,
        unitIndex: Math.max(0, this.data.units.indexOf(gb.unit)),
        expressEnabled: (gb.express_fee || 0) > 0,
        expressYuan: (gb.express_fee || 0) > 0 ? util.fen2yuan(gb.express_fee) : '',
        packageEnabled: (gb.package_fee || 0) > 0,
        packageYuan: (gb.package_fee || 0) > 0 ? util.fen2yuan(gb.package_fee) : '',
        bearerIndex: Math.max(0, this.data.bearers.findIndex(b => b.k === gb.fee_bearer)),
        date: util.formatDate(gb.deadline),
        time: `${util.pad(dl.getHours())}:${util.pad(dl.getMinutes())}`,
        pickupLocation: gb.pickup_location || '',
        remark: gb.remark || '',
        qrEnabled: !!gb.pay_qr_enabled,
        qrImage: gb.pay_qr_temp_url || '',
        qrFileID: gb.pay_qr_url || '',
        qrNote: gb.pay_qr_note || '',
        cashEnabled: !!gb.pay_cash_enabled,
        nickname: gb.initiator_nickname || this.data.nickname,
        avatar: gb.initiator_avatar_url || this.data.avatar,
        avatarFileID: gb.initiator_avatar || this.data.avatarFileID
      }, () => this.recalcPreview())
      wx.hideLoading()
    } catch (e) {
      wx.hideLoading()
      util.showError(e.message)
      setTimeout(() => wx.navigateBack(), 1200)
    }
  },

  /* ---------- 表单事件 ---------- */
  onField(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value }, () => this.recalcPreview())
  },

  onStorePick(e) { this.setData({ storeIndex: e.currentTarget.dataset.index }) },
  onCustomStore(e) { this.setData({ customStore: e.detail.value }) },
  onUnit(e) { this.setData({ unitIndex: Number(e.detail.value) }) },
  onDate(e) { this.setData({ date: e.detail.value }) },
  onTime(e) { this.setData({ time: e.detail.value }) },

  onExpressSwitch(e) { this.setData({ expressEnabled: e.detail.value }, () => this.recalcPreview()) },
  onPackageSwitch(e) { this.setData({ packageEnabled: e.detail.value }, () => this.recalcPreview()) },
  // radio 的 value 是 key（split/initiator/none），需换回索引
  onBearer(e) {
    const idx = this.data.bearers.findIndex(b => b.k === e.detail.value)
    this.setData({ bearerIndex: idx < 0 ? 0 : idx }, () => this.recalcPreview())
  },
  onQrSwitch(e) { this.setData({ qrEnabled: e.detail.value }) },
  onCashSwitch(e) { this.setData({ cashEnabled: e.detail.value }) },

  onChooseAvatar(e) {
    const temp = e.detail.avatarUrl
    this.setData({ avatar: temp, avatarUploading: true })
    util.uploadImage(temp, 'avatars').then(fileID => {
      this.setData({ avatar: temp, avatarFileID: fileID, avatarUploading: false })
    }).catch(() => {
      this.setData({ avatar: temp, avatarFileID: '', avatarUploading: false })
      util.showError('头像上传失败，可重选或继续发布')
    })
  },

  chooseProductImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const temp = res.tempFiles[0].tempFilePath
        this.setData({ productImage: temp, productImageID: '', productUploading: true })
        util.uploadImage(temp, 'products').then(fileID => {
          this.setData({ productImageID: fileID, productUploading: false })
        }).catch(() => {
          this.setData({ productUploading: false })
          util.showError('商品图片上传失败，请重新选择')
        })
      }
    })
  },

  chooseQrImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const temp = res.tempFiles[0].tempFilePath
        this.setData({ qrImage: temp, qrFileID: '', qrUploading: true })
        util.uploadImage(temp, 'qrcodes').then(fileID => {
          this.setData({ qrFileID: fileID, qrUploading: false })
        }).catch(() => {
          this.setData({ qrUploading: false })
          util.showError('收款码上传失败，请重新选择')
        })
      }
    })
  },

  /* ---------- 分摊预览 ----------
   * 每份单价 = 整包价格 ÷ 每包拆分数量（四舍五入到分）
   * 发起人自留份数不参与收款，剩余份数供邻居拼单 */
  recalcPreview() {
    const d = this.data
    const pkgPriceFen = util.yuanStrToFen(d.packagePriceYuan)
    const pkgShares = parseInt(d.packageShares, 10)
    const pkgs = parseInt(d.totalPackages, 10)
    const myShares = Math.max(0, parseInt(d.myShares, 10) || 0)
    if (!pkgPriceFen || !pkgShares || pkgShares < 1 || !pkgs || pkgs < 1) {
      this.setData({ preview: null })
      return
    }
    const totalShares = pkgShares * pkgs
    const goodsPerShare = Math.round(pkgPriceFen / pkgShares)
    const bearer = (d.bearers[d.bearerIndex] || d.bearers[0]).k
    const expressFen = d.expressEnabled && bearer !== 'none' ? util.yuanStrToFen(d.expressYuan) : 0
    const packageFen = d.packageEnabled && bearer !== 'none' ? util.yuanStrToFen(d.packageYuan) : 0
    const expressShare = bearer === 'split' ? Math.round(expressFen / totalShares) : 0
    const packageShare = bearer === 'split' ? Math.round(packageFen / totalShares) : 0
    const mySharesFinal = Math.min(myShares, totalShares)
    this.setData({
      preview: {
        package_price_text: util.fen2yuan(pkgPriceFen),
        package_shares: pkgShares,
        total_value_text: util.fen2yuan(pkgPriceFen * pkgs),
        total_shares: totalShares,
        goods_per_share_text: util.fen2yuan(goodsPerShare),
        per_share_text: util.fen2yuan(goodsPerShare + expressShare + packageShare),
        express_share_text: util.fen2yuan(expressShare),
        package_share_text: util.fen2yuan(packageShare),
        has_fees: expressShare > 0 || packageShare > 0,
        my_shares: mySharesFinal,
        left_text: totalShares - mySharesFinal,
        unit: d.units[d.unitIndex],
        bearer
      }
    })
  },

  /* ---------- 提交 ---------- */
  async onSubmit() {
    if (this.data.submitting) return
    const d = this.data

    const store = d.stores[d.storeIndex] === '其他' ? d.customStore.trim() : d.stores[d.storeIndex]
    if (!store) return util.showError('请填写商超名称')

    if (!d.productName.trim()) return util.showError('请填写商品名称')
    if (d.productUploading) return util.showError('商品图片上传中，请稍候')
    if (d.productImage && !d.productImageID) return util.showError('商品图片上传失败，请重新选择')

    const packagePriceFen = util.yuanStrToFen(d.packagePriceYuan)
    if (packagePriceFen <= 0) return util.showError('请填写正确的整包价格')
    const packageShares = parseInt(d.packageShares, 10)
    if (!packageShares || packageShares < 1 || packageShares > 999) return util.showError('每包拆分数量需为 1-999')
    const totalPackages = parseInt(d.totalPackages, 10)
    if (!totalPackages || totalPackages < 1 || totalPackages > 99) return util.showError('总包数需为 1-99')
    const totalShares = packageShares * totalPackages
    const initiatorShares = Math.max(0, parseInt(d.myShares, 10) || 0)
    if (initiatorShares > totalShares) return util.showError('自留份数不能超过总份数')

    const deadline = this.buildDeadline()
    if (!deadline) return util.showError('请选择截单日期和时间')
    if (deadline <= Date.now() + 60000) return util.showError('截单时间需晚于当前时间')

    const bearer = (d.bearers[d.bearerIndex] || d.bearers[0]).k
    if (d.expressEnabled && bearer !== 'none' && !d.expressYuan) {
      return util.showError('请填写快递费金额')
    }
    if (d.packageEnabled && bearer !== 'none' && !d.packageYuan) {
      return util.showError('请填写包装费金额')
    }
    if (!d.qrEnabled && !d.cashEnabled) return util.showError('至少开启一种收款方式')
    if (d.qrEnabled && d.qrUploading) return util.showError('收款码上传中，请稍候')
    if (d.qrEnabled && !d.qrFileID) return util.showError('请上传微信收款码图片')
    if (d.avatarUploading) return util.showError('头像上传中，请稍候')
    if (!d.nickname.trim()) return util.showError('请填写你的昵称，方便邻居认识你')

    const payload = {
      store,
      product_name: d.productName.trim(),
      product_image: d.productImageID,
      unit: d.units[d.unitIndex],
      package_price: packagePriceFen,
      package_shares: packageShares,
      total_packages: totalPackages,
      initiator_shares: initiatorShares,
      express_fee: d.expressEnabled ? util.yuanStrToFen(d.expressYuan) : 0,
      package_fee: d.packageEnabled ? util.yuanStrToFen(d.packageYuan) : 0,
      fee_bearer: bearer,
      deadline,
      pickup_location: d.pickupLocation.trim(),
      remark: d.remark.trim(),
      pay_qr_enabled: d.qrEnabled,
      pay_qr_url: d.qrFileID,
      pay_qr_note: d.qrNote.trim(),
      pay_cash_enabled: d.cashEnabled,
      nickname: d.nickname.trim(),
      avatar: d.avatarFileID
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: this.data.editing ? '保存中' : '发布中', mask: true })
    try {
      requestSubscribe()
      if (this.data.editing) {
        const res = await callCloud('updateGroupBuy', { id: this.data.editId, payload })
        wx.hideLoading()
        if (res && res.skip_warning) {
          // 有已付款记录未按新价重算，弹窗提示差额需线下协商
          wx.showModal({ title: '已保存', content: res.skip_warning, showCancel: false })
          setTimeout(() => wx.navigateBack(), 1800)
        } else {
          wx.showToast({ title: '已保存', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 600)
        }
      } else {
        const res = await callCloud('createGroupBuy', { payload })
        wx.hideLoading()
        wx.showToast({ title: '发布成功', icon: 'success' })
        wx.redirectTo({ url: `/pages/detail/detail?id=${res.id}` })
      }
    } catch (e) {
      wx.hideLoading()
      this.setData({ submitting: false })
      util.showError(e.message)
    }
  },

  buildDeadline() {
    const d = this.data
    if (!d.date || !d.time) return 0
    const [y, m, day] = d.date.split('-').map(Number)
    const [hh, mm] = d.time.split(':').map(Number)
    return new Date(y, m - 1, day, hh, mm, 0).getTime()
  }
})

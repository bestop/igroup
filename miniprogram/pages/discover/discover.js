const { callCloud } = require('../../utils/cloud')
const util = require('../../utils/util')
const C = require('../../utils/const')

// 分类关键词匹配（对商品名 + 商超名做包含匹配）
const CAT_KEYS = ['fresh', 'snack', 'daily']
const CAT_KEYWORDS = {
  fresh: ['水果', '蔬菜', '肉', '牛', '鸡', '鸭', '虾', '蟹', '鱼', '海鲜', '蛋', '奶', '生鲜', '菜', '果'],
  snack: ['零食', '卷', '酥', '饼', '糖', '巧克', '薯片', '坚果', '蛋糕', '面包', '蛋挞', '麻薯', '曲奇', '干'],
  daily: ['纸', '洗衣', '清洁', '牙膏', '洗发', '沐浴', '日用', '抽纸', '厨房', '保鲜']
}
const TILE_COLORS = ['#FFF7E6', '#E6F7FF', '#FFF1F0', '#F6FFED']
const TILE_EMOJI = { fresh: '🍓', snack: '🍰', daily: '🧴', other: '🛒' }

Page({
  data: {
    cats: ['全部', '我参与的', '我发起的', '生鲜', '零食', '日用'],
    activeCat: 0,
    keyword: '',
    all: [],
    featured: null,
    list: [],
    loading: true
  },

  onLoad() { this.refresh() },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    if (!this.data.loading) this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      const res = await callCloud('listDiscover')
      const all = (res.list || []).map((g, i) => this.decorate(g, res, i))
      this.setData({
        all,
        featured: all.length ? this.decorateFeatured(all[0]) : null,
        loading: false
      }, () => this.applyFilter())
    } catch (e) {
      this.setData({ loading: false })
      util.showError(e.message)
    }
  },

  decorate(g, res, i) {
    const cat = this.detectCat(g)
    return {
      id: g._id,
      product_name: g.product_name,
      store: g.store,
      unit: g.unit,
      price_text: util.fen2yuan(g.unit_price),
      total_shares: g.total_shares,
      sold_shares: g.sold_shares,
      remaining: Math.max(0, g.total_shares - g.sold_shares),
      deadline: g.deadline,
      deadline_short: this.shortDeadline(g.deadline),
      pickup_location: g.pickup_location,
      initiator_nickname: g.initiator_nickname || '',
      image_url: g.image_url || '',
      participant_count: g.participant_count || 0,
      is_mine: g.initiator_openid === res.openid,
      is_joined: (res.joined_ids || []).includes(g._id),
      emoji: TILE_EMOJI[cat] || TILE_EMOJI.other,
      tile: TILE_COLORS[i % TILE_COLORS.length]
    }
  },

  detectCat(g) {
    const text = `${g.store || ''}${g.product_name || ''}`
    for (const key of CAT_KEYS) {
      if (CAT_KEYWORDS[key].some(k => text.includes(k))) return key
    }
    return 'other'
  },

  decorateFeatured(g) {
    return Object.assign({}, g, { countdown: util.countdownText(g.deadline) })
  },

  shortDeadline(ts) {
    const d = new Date(ts)
    const now = new Date()
    const hm = `${util.pad(d.getHours())}:${util.pad(d.getMinutes())}`
    if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
  },

  onCat(e) {
    this.setData({ activeCat: Number(e.currentTarget.dataset.index) }, () => this.applyFilter())
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.applyFilter())
  },

  applyFilter() {
    const d = this.data
    const kw = (d.keyword || '').trim()
    const list = d.all.filter(g => {
      if (d.activeCat === 1 && !g.is_joined) return false
      if (d.activeCat === 2 && !g.is_mine) return false
      if (d.activeCat >= 3) {
        const keys = CAT_KEYWORDS[CAT_KEYS[d.activeCat - 3]] || []
        const text = `${g.store}${g.product_name}`
        if (!keys.some(k => text.includes(k))) return false
      }
      if (kw && !`${g.store}${g.product_name}${g.initiator_nickname}`.includes(kw)) return false
      return true
    })
    this.setData({ list })
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` })
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' })
  },

  onShareAppMessage() {
    return {
      title: '邻里拼单｜和邻居一起拼，更省钱',
      path: '/pages/discover/discover'
    }
  }
})

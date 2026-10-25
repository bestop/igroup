// 自定义底部导航：白色底板 + 珊瑚红选中态，与整体设计统一
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: '🏠' },
      { pagePath: '/pages/discover/discover', text: '发现', icon: '🧭' },
      { pagePath: '/pages/orders/orders', text: '我的订单', icon: '📋' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: '👤' }
    ]
  },
  methods: {
    switchTab(e) {
      const { path } = e.currentTarget.dataset
      wx.switchTab({ url: path })
    }
  }
})

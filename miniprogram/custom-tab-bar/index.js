// 自定义底部导航：白色底板 + 珊瑚红选中态，与整体设计统一
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: '/assets/icons/home-gray.png', iconActive: '/assets/icons/home-red.png' },
      { pagePath: '/pages/discover/discover', text: '发现', icon: '/assets/icons/compass-gray.png', iconActive: '/assets/icons/compass-red.png' },
      { pagePath: '/pages/orders/orders', text: '我的订单', icon: '/assets/icons/clipboard-gray.png', iconActive: '/assets/icons/clipboard-red.png' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: '/assets/icons/user-gray.png', iconActive: '/assets/icons/user-red.png' }
    ]
  },
  methods: {
    switchTab(e) {
      const { path } = e.currentTarget.dataset
      wx.switchTab({ url: path })
    }
  }
})

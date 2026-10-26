# 数据库索引创建指引

> 云开发数据库默认只有 `_id` 主键索引。随着拼单数 / 参与人数增长，
> 以下查询会退化为全表扫描。请按需在
> **微信开发者工具 → 云开发控制台 → 数据库 → 对应集合 → 索引管理 → 添加索引**
> 中手动创建（wx-server-sdk 不支持代码建索引）。

## 推荐索引清单

| # | 集合 | 字段（顺序即组合顺序） | 服务于 | 说明 |
|---|------|------------------------|--------|------|
| 1 | groupbuys | `status` ↑ + `deadline` ↑ | 发现页 `listDiscover`、定时截单 `autoCloseExpired` | 等值 status 在前，排序/范围 deadline 在后 |
| 2 | groupbuys | `initiator_openid` ↑ + `created_at` ↓ | `getMyCreated` 我发起的 | 列表倒序取全 |
| 3 | participants | `group_buy_id` ↑ + `joined_at` ↑ | `participantsOf`（详情名单/通知扇出/收款预览） | 最高频查询，建议优先创建 |
| 4 | participants | `group_buy_id` ↑ + `pay_status` ↑ | `confirmAllPay` 一键确认、`getMyCreated` 收款汇总 | |
| 5 | participants | `group_buy_id` ↑ + `pickup_status` ↑ | `confirmPickup` 剩余未提货计数 | |
| 6 | participants | `user_openid` ↑ + `joined_at` ↓ | `getMyOrders` 我的订单 | |
| 7 | notifications | `group_buy_id` ↑ + `receiver_openid` ↑ + `type` ↑ + `sent_at` ↓ | `remindPay` 24h 限频查重 | 四字段复合索引 |
| 8 | users | `openid` ↑ | `getUser` 旧格式兼容查询 | 新数据走 `_id` 主键，此索引仅为存量数据兜底 |

## 创建要点

1. **字段顺序遵循"等值在前、排序/范围在后"**：
   例如索引 1 中 `status` 是等值条件、`deadline` 是排序/范围条件，
   顺序颠倒会让排序部分无法走索引。
2. **方向要与查询一致**：`getMyOrders` 按 `joined_at` 倒序，建索引时选"降序"；
   发现页按 `deadline` 升序，选"升序"。
3. ** participants 集合写多读多**：索引 3~6 都在参与记录上，
   每次加入拼单会多付出少量索引维护成本，属于合理开销。
4. **先上量再补索引也不迟**：免费额度下几千条记录内全表扫描体感不明显；
   社区规模跑起来后，优先创建索引 1 和 3。

## 验证方式

控制台 → 数据库 → 高级 → 慢查询，上线后观察是否有全表扫描告警，
再对照上表补充缺失索引即可。

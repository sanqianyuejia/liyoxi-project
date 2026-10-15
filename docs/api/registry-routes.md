# 接口索引

由 `working/routemap.json` 生成，请勿手改；每条接口的字段级定义见对应文档的章节。

共 669 条（V1.0 613，V1.1 56）。列说明：“判权”为后台权限点或商家端能力点（`assert-in-handler` 表示处理器内按对象判定，见约定 C66）；“幂等”见约定 C46–C50。

| 端 | 前缀 | 文档 | 接口数 |
| --- | --- | --- | --- |
| 商家端（小程序） | `/api/v1/m` | [m01-account](m01-account.md)、[m02-tenant](m02-tenant.md)、[m03-profile-asset](m03-profile-asset.md)、[m04-mall-order](m04-mall-order.md)、[m05-delivery-publish](m05-delivery-publish.md)、[m06-ad](m06-ad.md)、[m07-billing](m07-billing.md)、[m08-support-misc](m08-support-misc.md) | 167 |
| 运营管理后台 | `/api/v1/admin` | [a01-system](a01-system.md)、[a02-workbench-report](a02-workbench-report.md)、[a03-merchant](a03-merchant.md)、[a04-content](a04-content.md)、[a05-order-delivery](a05-order-delivery.md)、[a06-publish](a06-publish.md)、[a07-billing-finance](a07-billing-finance.md)、[a08-support](a08-support.md)、[a09-ops](a09-ops.md) | 470 |
| 电脑端下载页 | `/api/v1/portal` | [p01-portal](p01-portal.md) | 17 |
| 外部回调与探活 | `/api/v1/hooks` | [h01-hooks](h01-hooks.md) | 15 |

## 商家端（小程序）

### [商家端：账号与登录](m01-account.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `m.agreementConsent.list` | GET | `/m/agreement-consents` | 已签署协议：协议名、版本、生效日期、最近确认时间与场景、首次签署时间与场景、关联单据 | — | none | V1.0 | 3.15 |
| `m.agreementConsent.create` | POST | `/m/agreement-consents` | 提交协议同意（登录后协议更新需要重新同意时）；交易类同意不走本接口 | — | natural（uq_agreement_consent_no_biz） | V1.0 | 3.14 |
| `m.agreementConsent.summary` | GET | `/m/agreement-consents/summary` | 合同页“协议 · N”的计数；查询参数同列表（除分页） | `contract.read` | none | V1.0 | 3.16 |
| `m.agreementVersion.get` | GET | `/m/agreement-versions/{agreementVersionId}` | 某一协议版本的正文（展示版）与 PDF 文件地址 | — | none | V1.0 | 3.13 |
| `m.agreement.list` | GET | `/m/agreements` | 当前生效的协议版本清单（?agreementKey= 或 ?scene=）：标题、版本号、生效时间、版本 id；登录前可读 | — | none | V1.0 | 3.12 |
| `m.me.get` | GET | `/m/me` | 当前账号：称呼与脱敏手机号、成员关系（主体概要、可访问门店与各门店角色）、待同意协议、一次性提示 | — | none | V1.0 | 3.4 |
| `m.me.update` | PATCH | `/m/me` | 修改称呼（过内容安全检测） | `me.*` | required | V1.0 | 3.5 |
| `m.me.changePhone` | POST | `/m/me/change-phone` | 换绑手机号：提交 {oldSmsCode, newPhoneCode}；保留当前会话、吊销其他会话（不换发令牌，A81）；新号码被从无成员关系的空账号占用时同事务清理该账号 | `me.*` | required | V1.0 | 3.7 |
| `m.me.deletion.create` | POST | `/m/me/deletion` | 注销账号：无成员关系或店员直接执行；老板须主体无生效套餐、在办订购、上线中成片、未完结资金单据，否则返回阻断项 | `me.*` | required | V1.0 | 3.11 |
| `m.me.userNotice.acknowledge` | POST | `/m/me/user-notices/{userNoticeId}/acknowledge` | 关闭一次性提示（如“账号在新的微信上登录”，老板下次打开首页时置顶展示） | `me.*` | required | V1.0 | 3.10 |
| `m.me.wechatIdentity.list` | GET | `/m/me/wechat-identities` | 已登录的微信列表：首次绑定时间、最近登录、设备摘要、是否当前设备（不返回 openid） | `me.*` | none | V1.0 | 3.8 |
| `m.me.wechatIdentity.delete` | DELETE | `/m/me/wechat-identities/{wechatIdentityId}` | 移除某个已登录的微信并吊销其全部会话；移除当前身份等同退出 | `me.*` | required | V1.0 | 3.9 |
| `m.session.create` | POST | `/m/sessions` | 静默登录：wx.login 的 loginCode 换会话；微信身份已绑定且允许静默登录时返回令牌与 me，否则返回 needPhone 保持游客态 | — | none | V1.0 | 3.1 |
| `m.session.current.delete` | DELETE | `/m/sessions/current` | 退出登录：吊销当前会话并关闭该微信身份的静默登录 | — | none | V1.0 | 3.3 |
| `m.session.phoneLogin` | POST | `/m/sessions/phone-login` | 手机号快捷登录/注册：{loginCode, phoneCode, consents, attribution}；首次登录建账号、记协议同意与来源；可能返回 REVERIFY_REQUIRED、switchedFrom | — | none | V1.0 | 3.2 |
| `m.smsCode.create` | POST | `/m/sms-codes` | 发送换绑手机号的短信验证码：purpose=phone_change，发到账号当前手机号 | `me.*` | required | V1.0 | 3.6 |

### [商家端：主体、门店与成员](m02-tenant.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `m.delegation.create` | POST | `/m/delegations` | V1.1：老板授权管理员代为确认方案、样片、广告（委托人、受托成员、能力点、门店范围、有效期） | — | required | V1.1 | 3.22 |
| `m.entity.create` | POST | `/m/entities` | 懒创建经营主体 + 首家门店 + 老板成员关系 + 计费账户；已是老板返回已有主体，已是别家店员返回 409 ALREADY_IN_ENTITY | — | required | V1.0 | 3.1 |
| `m.invitation.create` | POST | `/m/invitations` | 预创建邀请：校验名额（含待接受）、生成一次性令牌、24 小时有效、占一个名额；未分享的卡片复用同一行并重置有效期 | `member.manage` | natural（uq_invitation_inviter_member_id_client_request_id, uq_invitation_request_inviter_client） | V1.0 | 3.12 |
| `m.invitation.lookup` | GET | `/m/invitations/lookup` | 邀请落地页信息（?token=）：门店名、城市与品类、邀请人称呼、角色、有效期、状态（已使用、已撤回、已过期分别说明）、invitationId | — | none | V1.0 | 3.15 |
| `m.invitation.accept` | POST | `/m/invitations/{invitationId}/accept` | 接受邀请（请求体带 token）：校验令牌与状态、归属判定（空草稿主体让位）、建店员成员关系、通知老板 | — | required | V1.0 | 3.16 |
| `m.invitation.markShared` | POST | `/m/invitations/{invitationId}/mark-shared` | 上报已分享（端上尽力上报，用于判断卡片能否复用） | `member.manage` | required | V1.0 | 3.13 |
| `m.invitation.revoke` | POST | `/m/invitations/{invitationId}/revoke` | 撤回待接受的邀请（老板撤回；没分享就离开邀请页时端上尽力撤回），释放名额 | `member.manage` | required | V1.0 | 3.14 |
| `m.me.currentStore.replace` | PUT | `/m/me/current-store` | 记住当前门店（写 entity_member.last_store_id，供下次启动恢复） | `me.*` | required | V1.0 | 3.7 |
| `m.me.membership.leave` | POST | `/m/me/membership/leave` | 店员主动退出所在主体（同移除，原因 self，通知老板） | `me.*` | required | V1.0 | 3.11 |
| `m.member.list` | GET | `/m/members` | 当前门店的成员（姓名、角色、加入日期、上传数与被采用数、多门店提示）、待接受邀请（备注名、有效期）与名额；按角色裁剪 | `member.list` | none | V1.0 | 3.8 |
| `m.member.update` | PATCH | `/m/members/{memberId}` | 调整店员所属门店（全量替换，至少保留 1 家），立即生效并通知该成员 | `member.manage` | required | V1.0 | 3.9 |
| `m.member.remove` | POST | `/m/members/{memberId}/remove` | 移除店员：解除全部门店关系、释放名额、通知；其上传的素材保留在门店素材库 | `member.manage` | required | V1.0 | 3.10 |
| `m.portalSession.list` | GET | `/m/portal-sessions` | 已授权的电脑列表（浏览器、地区、授权时间、到期时间） | `portal.authorize` | none | V1.0 | 3.20 |
| `m.portalSession.revoke` | POST | `/m/portal-sessions/{portalSessionId}/revoke` | 撤销某台电脑的下载页授权 | `portal.authorize` | required | V1.0 | 3.21 |
| `m.portalTicket.lookup` | GET | `/m/portal-tickets/lookup` | 扫码或手输代码后取下载页登录票据摘要（?code=）：浏览器、大致地区、发起时间、到期时间、三个候选配对数字、票据 id | `portal.authorize` | none | V1.0 | 3.17 |
| `m.portalTicket.approve` | POST | `/m/portal-tickets/{portalTicketId}/approve` | 允许这台电脑下载本店成片：{pairDigits}；配对数字不一致则票据作废 | `portal.authorize` | required | V1.0 | 3.18 |
| `m.portalTicket.reject` | POST | `/m/portal-tickets/{portalTicketId}/reject` | 拒绝下载页登录 | `portal.authorize` | required | V1.0 | 3.19 |
| `m.store.list` | GET | `/m/stores` | 我可见的门店：审核状态、完整度、提交与预计完成时间、上线中/交付中/素材/店员计数、待办数；主体额度（门店 n/N、成员名额 n/N，店员不含）；含已停用门店并标注 | — | none | V1.0 | 3.2 |
| `m.store.create` | POST | `/m/stores` | 新增门店并按勾选复制档案（基础信息、服务与价格、门店形象、品牌故事素材）；校验主体门店额度 | `store.create` | required | V1.0 | 3.3 |
| `m.store.archive` | POST | `/m/stores/{storeId}/archive` | 停用门店：返回阻断项清单（在办订购、未归档工单、制作中广告、审核中的资质与账号）或停用成功 | `store.archive` | required | V1.0 | 3.4 |
| `m.store.delete` | POST | `/m/stores/{storeId}/delete` | 删除草稿门店（从未提交资质且无业务数据、不是最后一家）；不物理删除，置为已停用 | `store.archive` | required | V1.0 | 3.5 |
| `m.store.restore` | POST | `/m/stores/{storeId}/restore` | 恢复老板停用的门店（重新校验门店额度） | `store.restore` | required | V1.0 | 3.6 |

### [商家端：门店档案、资质与素材](m03-profile-asset.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `m.assetDemand.list` | GET | `/m/asset-demands` | 素材需求（?status=open）：名称、拍摄说明、发起的服务经理、完成日期 | `asset.demand.read` | none | V1.0 | 3.25 |
| `m.qualificationDoc.create` | POST | `/m/qualification-docs` | 证照挂到草稿并同步识别回显：{fileId, docType: business_license \| branch_license \| industry_permit, permitType?}；同类旧证照从草稿移除 | `store.qualification.edit` | required | V1.0 | 3.12 |
| `m.qualificationDoc.update` | PATCH | `/m/qualification-docs/{qualificationDocId}` | 保存核对后的证照提交值（识别有误时人工修正） | `store.qualification.edit` | required | V1.0 | 3.13 |
| `m.qualificationDoc.downloadUrls` | POST | `/m/qualification-docs/{qualificationDocId}/download-urls` | 签发证照图片的 5 分钟读地址（本门店草稿、在审或生效证照），每次写访问审计 | `store.qualification.edit` | none | V1.0 | 3.15 |
| `m.qualificationDoc.remove` | POST | `/m/qualification-docs/{qualificationDocId}/remove` | 从草稿移除证照（释放文件引用，保留 7 天） | `store.qualification.edit` | required | V1.0 | 3.14 |
| `m.qualificationSubmission.list` | GET | `/m/qualification-submissions` | 历次审核记录：提交、驳回（原因分类、说明、被驳回证照）、重新提交、通过的时间线 | `store.qualification.edit` | none | V1.0 | 3.18 |
| `m.storeAsset.list` | GET | `/m/store-assets` | 门店素材列表（游标分页，按上传时间倒序）：?tab=（素材类型页签）&status=&tag=&q=&uploader=me&isSelectableAsReference=&assetDemandId=&ids=；卡片含缩略图、角标、标题、状态、上传人与角色、引文、标签 | `asset.read` | none | V1.0 | 3.19 |
| `m.storeAsset.create` | POST | `/m/store-assets` | 创建门店素材：{type, fileIds[], textBody?, contentTagCodes[], note?, assetDemandId?}，并投递理解任务（转写、识别、提炼） | `asset.upload` | required | V1.0 | 3.22 |
| `m.storeAsset.summary` | GET | `/m/store-assets/summary` | 素材库计数：各类型页签计数、整理中数量、热门标签；带 uploader=me 时给“我上传的 N 条 · M 条被采用” | `asset.read` | none | V1.0 | 3.20 |
| `m.storeAsset.get` | GET | `/m/store-assets/{storeAssetId}` | 素材详情：文件签名地址、转写全文、要点、分维度标签（内容/用途/时效/可用性）、复核人与时间、使用记录 | `asset.read` | none | V1.0 | 3.21 |
| `m.storeAsset.feedback.create` | POST | `/m/store-assets/{storeAssetId}/feedback` | 素材标签有误等轻量反馈（反馈内容，≤200 字）；写审计并通知交付经理 | `asset.feedback` | required | V1.0 | 3.24 |
| `m.storeAsset.portraitAuth.create` | POST | `/m/store-assets/{storeAssetId}/portrait-auth` | 为“需肖像授权”的素材补交授权材料（fileIds） | `asset.upload` | required | V1.0 | 3.23 |
| `m.storeProfile.get` | GET | `/m/store-profile` | 建档首页聚合：完整度、四步摘要与状态、审核状态、主体名称、素材总数与近 7 天新增、成员摘要、广告三态计数；按角色裁剪 | `store.profile.read` | none | V1.0 | 3.1 |
| `m.storeProfile.basic.get` | GET | `/m/store-profile/basic` | 建档第 1 步：品牌名称与 Logo、门店名称、行业品类、地址与选点、营业时间、电话、人均、品牌简介；重审字段的生效值与待审值 | `store.profile.read` | none | V1.0 | 3.2 |
| `m.storeProfile.basic.update` | PATCH | `/m/store-profile/basic` | 保存第 1 步（只存草稿）：{draft, lockVersion, confirmReview?}；已通过门店改名称/地址/行业品类时先返回 409 REVIEW_REQUIRED，确认后重审字段写入 change 草稿；提交走 m.storeProfile.qualification.submit | `store.profile.edit` | required | V1.0 | 3.3 |
| `m.storeProfile.contact.update` | PATCH | `/m/store-profile/contact` | 保存资质联系人：{name, phoneSource: login \| input, phone?, smsCode?, lockVersion}；改成非登录手机号须带短信验证码（短信未配置时记为未验证并提示审核人） | `store.qualification.edit` | required | V1.0 | 3.10 |
| `m.storeProfile.contactSmsCode.create` | POST | `/m/store-profile/contact/sms-codes` | 资质联系人手机号发码：{phone}；号码是登录手机号时不发码（isLoginPhone）；否则发 6 位验证码，5 分钟有效 | `store.qualification.edit` | required | V1.0 | 3.11 |
| `m.storeProfile.media.get` | GET | `/m/store-profile/media` | 建档第 2 步：门头、店内环境、服务或产品实拍、已有宣传素材四组媒体（标签、类型、时长、顺序） | `store.profile.read` | none | V1.0 | 3.4 |
| `m.storeProfile.media.update` | PATCH | `/m/store-profile/media` | 保存第 2 步（整步覆盖四组媒体的 fileId、标签、顺序；校验门头 ≥1、环境 ≥3） | `store.profile.edit` | required | V1.0 | 3.5 |
| `m.storeProfile.qualification.get` | GET | `/m/store-profile/qualification` | 当前资质视图：草稿或在审轮次、主体类型、证照元数据与识别结果、生效证照、驳回原因与被驳回的证照、预计完成时间；老板视图另带资质联系人 contact {name, phoneMask, phoneVerifyState, phoneVerifiedAt} 与在审轮次的 contactSnapshot；店员只有状态 | `store.profile.read` | none | V1.0 | 3.8 |
| `m.storeProfile.qualification.update` | PATCH | `/m/store-profile/qualification` | 保存第 4 步草稿：主体类型（企业/个体工商户）、信息确认；没有草稿时建草稿轮次（ensureDraft） | `store.qualification.edit` | required | V1.0 | 3.9 |
| `m.storeProfile.qualification.discard` | POST | `/m/store-profile/qualification/discard` | 丢弃资质草稿（放弃变更） | `store.qualification.edit` | required | V1.0 | 3.16 |
| `m.storeProfile.qualification.submit` | POST | `/m/store-profile/qualification/submit` | 提交资质审核（首次、驳回后重新提交、已通过后的变更）：十项提交校验、建审批单、进入审核队列 | `store.qualification.edit` | required | V1.0 | 3.17 |
| `m.storeProfile.service.get` | GET | `/m/store-profile/service` | 建档第 3 步：主推服务（名称、现价、原价、图片、简介）、优惠活动、团购信息、核心卖点与补充说明 | `store.profile.read` | none | V1.0 | 3.6 |
| `m.storeProfile.service.update` | PATCH | `/m/store-profile/service` | 保存第 3 步（整步覆盖，含主推服务数组 1～10 项、卖点标签 ≤5） | `store.profile.edit` | required | V1.0 | 3.7 |

### [商家端：商城、选剧单与订购](m04-mall-order.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `m.cancelRequest.create` | POST | `/m/cancel-requests` | V1.1：商家自助申请取消订购或广告（退款申请） | — | required | V1.1 | 3.21 |
| `m.cartItem.list` | GET | `/m/cart-items` | 选剧单（当前门店）：每项 valid / price_changed / invalid、加入时价格快照与当前价、折后实扣、可使用至；合计与可用积分 | `cart.*` | none | V1.0 | 3.10 |
| `m.cartItem.create` | POST | `/m/cart-items` | 加入选剧单 {dramaId}（同店同剧唯一，上限 50 部） | `cart.*` | natural（uq_cart_item_store_id_drama_id） | V1.0 | 3.11 |
| `m.cartItem.delete` | DELETE | `/m/cart-items/{cartItemId}` | 移出选剧单 | `cart.*` | required | V1.0 | 3.12 |
| `m.cartItem.acceptPrice` | POST | `/m/cart-items/{cartItemId}/accept-price` | 确认新价格 {acceptedPricePoints}（与当前价比对，不符返回 CART_PRICE_CHANGED；把价格快照更新为当前价，恢复可勾选） | `cart.*` | required | V1.0 | 3.13 |
| `m.drama.list` | GET | `/m/dramas` | 商城列表：?q=（关键词）、genreCodes（题材）、industryCodes（适配行业）、集数、积分价区间、排序、分页（20/页）；老板另返回按当前套餐算的实扣积分 | `catalog.read` | none | V1.0 | 3.4 |
| `m.drama.search` | GET | `/m/dramas/search` | 搜索（?q=）：按剧名、题材、主演匹配，剧名命中在前；未命中且关键词属于某品类时按适配行业兜底，返回 mode: match \| industry_fallback | `catalog.read` | none | V1.0 | 3.5 |
| `m.drama.get` | GET | `/m/dramas/{dramaId}` | 短剧详情：基础信息、积分价与实扣、当前可用积分与即将清零（老板）、简介与角色、适配推荐、定制与植入说明、许可与可使用至、订购须知 | `catalog.read` | none | V1.0 | 3.6 |
| `m.drama.trialEpisode.list` | GET | `/m/dramas/{dramaId}/trial-episodes` | V1.1：选集试看（前 N 集免费试看） | `catalog.read` | none | V1.1 | 3.7 |
| `m.favorite.create` | POST | `/m/favorites` | V1.1：收藏短剧 {dramaId} | — | required | V1.1 | 3.8 |
| `m.favorite.delete` | DELETE | `/m/favorites/{favoriteId}` | V1.1：取消收藏 | — | required | V1.1 | 3.9 |
| `m.home.get` | GET | `/m/home` | 首页聚合：城市、Banner、公告条、上线概览与清零提醒（老板）、为您推荐、推荐/新剧两栏各 4 部、选剧单数 | — | none | V1.0 | 3.1 |
| `m.mallConfig.get` | GET | `/m/mall-config` | 商城配置：题材分类、筛选项、排序项、热门搜索词 | — | none | V1.0 | 3.3 |
| `m.orderItem.list` | GET | `/m/order-items` | 我的短剧（以订单项为行，?tab=all\|live\|to_launch\|ended）：剧名、剩余天数、发布账号、使用期、订单号、各剧制作阶段与约定上线日 | `order.read` | none | V1.0 | 3.18 |
| `m.orderItem.summary` | GET | `/m/order-items/summary` | 我的短剧的页签计数：上线中 · N 部、待上线 · N 部等，键与列表 tab 取值一致；另带副指标 delivering（制作中 + 待上线，供“我的”页与门店卡） | `order.read` | none | V1.0 | 3.19 |
| `m.orderItem.get` | GET | `/m/order-items/{orderItemId}` | 订单项详情：剧目、整部集数、上线状态与已上线集数、使用期起止与剩余天数、发布账号、订单号 | `order.read` | none | V1.0 | 3.20 |
| `m.order.list` | GET | `/m/orders` | 我的订单（?tab=all\|producing\|to_launch\|live\|ended\|after_sale；?no= 按单号查找）：订单号、时间、状态、剧目概要、积分、置顶待办；售后页签含取消与积分退回 | `order.read` | none | V1.0 | 3.16 |
| `m.order.create` | POST | `/m/orders` | 确认订购：{dramaIds, channelAccountIds, focusCodes, referenceStoreAssetIds?, note?, isTopModel?, adIds?, expectedLaunchDate?, agreementVersionId, expect}；逐部冻结积分，建订购单与订单项，记协议同意 | `order.create` | required | V1.0 | 3.15 |
| `m.order.quote` | POST | `/m/orders/quote` | 订购报价（纯计算不落库）：逐部积分价、折扣、顶级模型加扣、实扣、合计、扣减来源（各批次套餐积分 / 加购积分）、订购后剩余、可选账号、可用广告、最早可指定上线日、主体与门店联系人 | `order.create` | none | V1.0 | 3.14 |
| `m.order.get` | GET | `/m/orders/{orderId}` | 订单详情：状态与待办、交付时间轴、剧目明细（含已上线集数与使用期）、方案摘要与 deliveryPlanId、积分明细（冻结、扣减、三个实际退回数量）、订单信息、协议与授权书列表 | `order.read` | none | V1.0 | 3.17 |
| `m.todo.list` | GET | `/m/todos` | 待办（?limit=&cursor=&orderId=&orderItemId=；首页最多 3 条、订单卡片置顶）：方案/广告/样片待确认、上线待回填或需补充、下架待确认、账号核验未通过、资质被驳回、工单待您确认、素材需求；按紧急度排序，游标分页 | `todo.read` | none | V1.0 | 3.2 |

### [商家端：交付与发布](m05-delivery-publish.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `m.channelAccount.list` | GET | `/m/channel-accounts` | 当前门店的渠道账号：平台、账号名称与 ID、状态（待核验/可用/异常）、认证类型、使用情况、异常原因与处理指引 | `channel.manage` | none | V1.0 | 3.1 |
| `m.channelAccount.create` | POST | `/m/channel-accounts` | 绑定渠道账号：{platform, accountName, accountId, accountType, screenshotFileIds}，生成账号核验单 | `channel.manage` | required | V1.0 | 3.2 |
| `m.channelAccount.submit` | POST | `/m/channel-accounts/{channelAccountId}/submit` | 核验未通过后重新上传主页截图（可重选账号类型；名称与账号 ID 不可改） | `channel.manage` | required | V1.0 | 3.3 |
| `m.channelAccount.unbind` | POST | `/m/channel-accounts/{channelAccountId}/unbind` | 解绑渠道账号（无交付中、上线中订单项且无未核查的下架任务） | `channel.manage` | required | V1.0 | 3.4 |
| `m.deliveryPlan.get` | GET | `/m/delivery-plans/{deliveryPlanId}` | 方案确认页：状态（待确认/修改中/已确认）、当前版本内容、推送人与时间、修改请求记录、剧目与上线账号、定制内容、植入形式与广告、上线安排 | `order.read` | none | V1.0 | 3.5 |
| `m.deliveryPlan.confirm` | POST | `/m/delivery-plans/{deliveryPlanId}/confirm` | 确认方案 {versionNo}：内容落到订单项、发布账号、广告位绑定，推进交付工单 | `delivery.confirm_plan` | required | V1.0 | 3.6 |
| `m.deliveryPlan.requestChange` | POST | `/m/delivery-plans/{deliveryPlanId}/request-change` | 联系服务经理修改 / 补充修改意见：{kinds[]（上线日期、上线账号、定制内容、植入形式、广告视频、其他）, note ≤200} | `delivery.confirm_plan` | required | V1.0 | 3.7 |
| `m.download.report` | POST | `/m/downloads/{downloadId}/report` | 回报保存相册的结果 {result: saved \| failed} | `delivery.download` | required | V1.0 | 3.15 |
| `m.launchTask.list` | GET | `/m/launch-tasks` | 上线任务（?tab=todo\|done&orderId=&orderItemId=）：按订单聚合，约定上线日与剩余天数、成片包摘要、逐剧逐账号状态（待发布/核验中/需补充/已通过）与核验结果 | `publish.read` | none | V1.0 | 3.17 |
| `m.launchTask.summary` | GET | `/m/launch-tasks/summary` | 发布任务页“待上线 N / 已完成 N”中上线任务一侧的计数，键与列表 tab 取值一致 | `publish.read` | none | V1.0 | 3.18 |
| `m.launchTask.get` | GET | `/m/launch-tasks/{launchTaskId}` | 上线记录（一个账号）：上线日期、发布方式、链接、核验项与结论、回填与核验时间线、作品巡检记录与检查项 | `publish.read` | none | V1.0 | 3.19 |
| `m.launchTask.submit` | POST | `/m/launch-tasks/{launchTaskId}/submit` | 回填上线链接并提交核验：{collectionUrl 或逐集作品链接, actualLaunchDate, episodeCount} | `publish.submit_link` | required | V1.0 | 3.20 |
| `m.licenseLetter.list` | GET | `/m/license-letters` | 定制内容授权书列表（?orderId=）：剧名、状态（待生效/生效中/已失效）、规格、授权期限、订单号、生成时间；按剧目 × 发布账号各 1 份 | `contract.read` | none | V1.0 | 3.24 |
| `m.licenseLetter.summary` | GET | `/m/license-letters/summary` | 合同页“定制内容授权书 · N”的计数；查询参数同列表（除分页） | `contract.read` | none | V1.0 | 3.25 |
| `m.licenseLetter.get` | GET | `/m/license-letters/{licenseLetterId}` | 授权书详情（预览）：授权方、被授权方、下单门店、剧名与集数、许可信息、授权平台与账号、授权期限、权利范围、专属声明、验真码 | `contract.read` | none | V1.0 | 3.26 |
| `m.licenseLetter.downloadUrls` | POST | `/m/license-letters/{licenseLetterId}/download-urls` | 签发授权书 PDF 的 5 分钟读地址，每次写访问审计 | `contract.read` | none | V1.0 | 3.27 |
| `m.orderItem.downloadGrant.create` | POST | `/m/order-items/{orderItemId}/download-grants` | 重新生成下载授权（每日至多 5 次），旧授权作废 | `delivery.download` | required | V1.0 | 3.13 |
| `m.orderItem.downloadUrls` | POST | `/m/order-items/{orderItemId}/download-urls` | 逐集下载 {kind: episode, episodeNo}：校验下载授权，写 delivery_download_log，返回 15 分钟直链与 downloadId | `delivery.download` | none | V1.0 | 3.14 |
| `m.orderItem.publishList.get` | GET | `/m/order-items/{orderItemId}/publish-list` | 发布清单：合集名称、每集标题、话题、简介（供复制） | `publish.read` | none | V1.0 | 3.16 |
| `m.orderItem.release.get` | GET | `/m/order-items/{orderItemId}/release` | 当前成片包：逐集清单（集号、大小、是否有变更）、总大小、下载授权状态与到期时间 | `delivery.download` | none | V1.0 | 3.12 |
| `m.orderItem.sample.get` | GET | `/m/order-items/{orderItemId}/sample` | 样片确认页：当前推送版本、时长、查看方式（preview_channels）、广告位标记（出现时间、类型）、质检摘要；不可在小程序内播放时不返回播放地址，返回查看方式说明 | `delivery.confirm_sample` | none | V1.0 | 3.8 |
| `m.performanceReport.list` | GET | `/m/performance-reports` | V1.1：投放数据（概览、按周趋势、单集数据、月度效果报告） | — | none | V1.1 | 3.28 |
| `m.performanceUpload.create` | POST | `/m/performance-uploads` | V1.1：商家每周上传作品数据截图，发布专员审核后录入 | — | required | V1.1 | 3.29 |
| `m.sample.confirm` | POST | `/m/samples/{sampleId}/confirm` | 确认样片 {versionNo, viewedVia, hasViewed}，推进到批量合成 | `delivery.confirm_sample` | required | V1.0 | 3.9 |
| `m.sample.downloadUrls` | POST | `/m/samples/{sampleId}/download-urls` | 签发水印版样片的 15 分钟直链（保存到相册查看）；每次写访问审计，首次访问回写 sample.first_viewed_at | `delivery.confirm_sample` | none | V1.0 | 3.11 |
| `m.sample.requestChange` | POST | `/m/samples/{sampleId}/request-change` | 对样片提出修改意见（合成问题）：{feedbackKind: 'compose', note, imageFileIds?} | `delivery.confirm_sample` | required | V1.0 | 3.10 |
| `m.takedownTask.list` | GET | `/m/takedown-tasks` | 下架任务（?tab=pending\|done）：剧目、账号、使用期止日、应完成日；无任务时给出最早结束剧目与下架任务生成日 | `publish.read` | none | V1.0 | 3.21 |
| `m.takedownTask.summary` | GET | `/m/takedown-tasks/summary` | 发布任务页“待下架 N / 已完成 N”中下架任务一侧的计数，键与列表 tab 取值一致 | `publish.read` | none | V1.0 | 3.22 |
| `m.takedownTask.confirm` | POST | `/m/takedown-tasks/{takedownTaskId}/confirm` | 确认已下架 {method: delete \| private \| not_published} | `publish.takedown_confirm` | required | V1.0 | 3.23 |

### [商家端：广告](m06-ad.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `m.ad.list` | GET | `/m/ads` | 我的广告（?tab=all\|producing\|pending_confirm\|revising\|confirmed，缺省 all；type=opening\|ending；isSelectable=true；sort=-updatedAt\|-submittedAt）：封面、类型与时长、状态与商家端显示状态、等待原因、文案、宣传重点、剩余免费修改次数、使用中剧目数与首部剧名、当前版本与查看方式、预计完成时间、可执行动作 | `ad.request` | none | V1.0 | 3.1 |
| `m.ad.create` | POST | `/m/ads` | 提交广告制作需求并冻结积分：{type, durationSec, promoPointCodes[1-5], copy ≤50, remark ≤200, referenceStoreAssetIds ≤9, referenceFileIds ≤9（档案媒体）, expectChargePoints, agreementVersionId, isAgreementChecked}；响应 AdState | `ad.request` | required | V1.0 | 3.3 |
| `m.ad.quote` | POST | `/m/ads/quote` | 广告计价（纯计算）：单价、套餐折扣、应冻结积分、免费修改次数、套餐名、可用积分与提交后可用积分、开放类型与可选时长、门店闸门、blockers（{code, message}，code 取错误符号）、协议现行版本与是否需勾选 | `ad.request` | none | V1.0 | 3.2 |
| `m.ad.get` | GET | `/m/ads/{adId}` | 广告详情：版本列表与分段标注（segments）、当前版本 playable（资产就绪时返回，sources 仅当版本查看方式含 weapp 且开关开时有值）、viewEvidence 与 confirmableVia、查看出口 alternatives、状态与说明、剩余免费次数与超次单价、修改截图上限、制作信息与参考素材（含档案分组 mediaGroup）、制作记录（商家可见的 8 类迁移）、关联订单的影响提示、相关工单 relatedServiceTickets | `ad.request` | none | V1.0 | 3.4 |
| `m.ad.confirm` | POST | `/m/ads/{adId}/confirm` | 确认使用广告版本 {versionNo, viewedVia, hasViewed}（viewedVia 必填，落 ad_version.confirm_viewed_via） | `ad.confirm` | required | V1.0 | 3.5 |
| `m.ad.downloadUrls` | POST | `/m/ads/{adId}/download-urls` | 签发当前版本广告视频文件的短时下载地址（ad_version.file_id，广告不加水印，A97）以保存到相册查看，请求体 {versionNo}，有效期 15 分钟；写访问审计（ad.version.album_download）；该版本的查看方式含 album 时可用；开关推送后被关闭、版本只有 weapp 时按样片同一兜底也可签发 | `ad.request` | none | V1.0 | 3.8 |
| `m.ad.requestChange` | POST | `/m/ads/{adId}/request-change` | 提出修改意见：{versionNo, segmentIndex \| timeStartMs+timeEndMs \| 都不传（整条广告）, note ≤200, screenshotFileIds（≤参数 ad.revision_screenshot_max，默认 1）, acceptChargePoints}；超出免费次数时按 1 条扣积分；响应 {ad: AdState, revision} | `ad.confirm` | required | V1.0 | 3.6 |
| `m.ad.submit` | POST | `/m/ads/{adId}/submit` | 被退回补充素材后重新提交（不重复冻结，时限重新计算）：{copy?, remark?, addReferenceStoreAssetIds?, addReferenceFileIds?}，可改文案、备注并追加参考素材（按来源各与已有合计 ≤9），可为空对象；响应 AdState | `ad.request` | required | V1.0 | 3.7 |
| `m.playable.get` | GET | `/m/playables/{playableId}` | 换取播放地址（地址过期或播放报错时换新）：返回 Playable（kind、sources（广告 source 一档、样片水印版一档、预告片 sd/hd）、海报、时长、宽高、到期时间）；受 weapp.video.* 开关控制 | `assert-in-handler` | none | V1.0 | 3.9 |

### [商家端：套餐、积分、付款与发票](m07-billing.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `m.invoiceRequest.list` | GET | `/m/invoice-requests` | 开票记录：类型、介质、项目、状态（开票中/已开具/已驳回/红冲中/已红冲）、金额、申请单号、付款单号、申请与开具时间、发票号码、进度说明 | `invoice.*` | none | V1.0 | 3.15 |
| `m.invoiceRequest.create` | POST | `/m/invoice-requests` | 按付款单申请开票：{paymentOrderId, invoiceType, medium, 专票地址电话与开户行账号, 接收邮箱, 邮寄信息（收件电话用 phoneSource）}；抬头与税号取认证主体，不接收 | `invoice.*` | required | V1.0 | 3.17 |
| `m.invoiceRequest.summary` | GET | `/m/invoice-requests/summary` | 开票页“开票记录 · N”计数、各状态计数，以及开票页上下文（抬头卡、申请弹层默认值） | `invoice.*` | none | V1.0 | 3.16 |
| `m.invoiceRequest.downloadUrls` | POST | `/m/invoice-requests/{invoiceRequestId}/download-urls` | 签发发票文件的 5 分钟读地址（请求体指明哪一张：蓝字或红字），每次写访问审计 | `invoice.*` | none | V1.0 | 3.18 |
| `m.paymentOrder.list` | GET | `/m/payment-orders` | 付款单列表（?invoiceState=eligible,applying 为“可开票”页签，含“已申请，开票中”的单）：类型、单号、金额、标题、时间、支付方式、开票项目、开票状态 | `invoice.*` | none | V1.0 | 3.13 |
| `m.paymentOrder.create` | POST | `/m/payment-orders` | 创建付款单（不传类型，按内容判定套餐或加购；记录《会员服务协议》《积分规则》同意）；对公同时返回收款账户与转账备注（= 付款单号） | `plan.purchase` | required | V1.0 | 3.7 |
| `m.paymentOrder.summary` | GET | `/m/payment-orders/summary` | 开票页“可开票 · N”的计数（查询参数同列表，页面传 invoiceState=eligible，不算已申请的单） | `invoice.*` | none | V1.0 | 3.14 |
| `m.paymentOrder.get` | GET | `/m/payment-orders/{paymentOrderId}` | 付款单详情与状态（含“已收到付款，正在处理”）、生效时间或到账积分、对公收款账户 | `plan.purchase` | none | V1.0 | 3.8 |
| `m.paymentOrder.cancel` | POST | `/m/payment-orders/{paymentOrderId}/cancel` | 取消付款单：微信支付先查单再关单、以结果为准（查得已支付则入账，返回 outcome = paid）；对公在凭证待财务确认期间不可取消；响应 CancelResult {outcome: cancelled \| paid \| cancelling, paymentOrder} | `plan.purchase` | required | V1.0 | 3.11 |
| `m.paymentOrder.sync` | POST | `/m/payment-orders/{paymentOrderId}/sync` | 让服务端主动查单并尝试入账，返回付款单状态（每单每 3 秒一次） | `plan.purchase` | none | V1.0 | 3.10 |
| `m.paymentOrder.transferProof.create` | POST | `/m/payment-orders/{paymentOrderId}/transfer-proofs` | 提交或重新上传对公转账凭证 {fileId}（回单截图或照片），财务 1 个工作日内确认 | `plan.purchase` | required | V1.0 | 3.12 |
| `m.paymentOrder.wechatPrepay` | POST | `/m/payment-orders/{paymentOrderId}/wechat-prepay` | 微信预下单，返回 wx.requestPayment 调起参数（三段式用例，幂等于 out_trade_no） | `plan.purchase` | required | V1.0 | 3.9 |
| `m.plan.list` | GET | `/m/plans` | 上架中的套餐版本与权益（月费、每月积分、折扣、制作模型、门店与成员上限、排期）；是否返回价格与购买入口由购买策略决定 | `plan.purchase` | none | V1.0 | 3.4 |
| `m.plan.quote` | POST | `/m/plans/quote` | 套餐报价（不落库）：{planId, months}→ 动作类型（开通/续费/升级/降级/下期换版本）、应付、新周期、积分发放与补发、补差价、降级须移除的门店与成员数；附购买策略 | `plan.purchase` | none | V1.0 | 3.5 |
| `m.pointLedgerEntry.list` | GET | `/m/point-ledger-entries` | 积分明细（?tab=all\|gain\|use\|expire&month=YYYY-MM，默认当月，逐月加载）：标题、积分来源、时间、门店与关联单号、计算式备注、数量；响应带 prevMonth 与 firstEntryAt | `ledger.read` | none | V1.0 | 3.2 |
| `m.pointPack.list` | GET | `/m/point-packs` | 上架中的加购积分包（积分数、价格） | `points.topup` | none | V1.0 | 3.6 |
| `m.purchasePolicy.get` | GET | `/m/purchase-policy` | 购买策略（mode、isPriceShown、isPurchasePromptAllowed、channels[]、copy），给没有金额上下文的入口用（如钱包页的续费与加购入口、积分不足引导） | `plan.purchase` | none | V1.0 | 3.3 |
| `m.wallet.get` | GET | `/m/wallet` | 套餐与积分：当前套餐（版本、状态、有效期、剩余天数、周期、权益）、门店与成员名额（同 m02 2.1）、两类积分余额、冻结数、即将清零数量与时刻、过期态（已清零数量、加购积分停用）、是否退款处理中（主体级）、加购拦截态、积分规则参数 | `wallet.read` | none | V1.0 | 3.1 |

### [商家端：客服、消息与通用接口](m08-support-misc.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `m.analyticsEvent.batchCreate` | POST | `/m/analytics-events` | 埋点批量上报 {sentAt, anonymousId, sessionId, clientVersion, platform, scene?, events[1–50]: {eventId, name, occurredAt, storeId?, props}}；端上只报 app_launch、profile_step_save、store_switch、mall_view、trailer_play、drama_detail_view、share_click 与扩展事件 banner_click、playback_fallback、trailer_first_frame，各事件 props schema 见 m08 2.11 | — | none | V1.0 | 3.26 |
| `m.bootstrap.get` | GET | `/m/bootstrap` | 启动引导：serverTime、minClientVersion、flags、versions（dict/site/agreement）、uploadLimits、download.weappSaveMode、copy、support（在线客服模式）、degraded、notice（停机维护说明）、pendingConsents、subscribePlan、context | — | none | V1.0 | 3.1 |
| `m.clientError.create` | POST | `/m/client-errors` | 小程序错误上报转发（Sentry envelope，≤200KB、白名单、限流，立即 202） | — | none | V1.0 | 3.27 |
| `m.dictItem.list` | GET | `/m/dict-items` | 数据字典（?typeKey=industry,region,genre,selling_tag,store_selling_point,permit_type,custom_focus,asset_tag,ad_promo_point,ticket_type,ticket_withdraw_reason,plan_tier,point_type&parentCode=&includeDisabled=）；响应 { items: DictTypeItems[] }（有界小集合，C42、A78） | — | none | V1.0 | 3.2 |
| `m.faq.list` | GET | `/m/faqs` | V1.1：常见问题（按分类） | — | none | V1.1 | 3.13 |
| `m.file.create` | POST | `/m/files` | 上传登记（一次 1–9 个文件）：{category, licenseKind?, files[]: {fileName, sizeBytes, clientToken}} → items[]: FileRegistration（fileId、通道 post \| multipart、写入区 bucket/region/key、post 表单或 sts 临时密钥、chunkSize、expiresAt、credentialsLeft） | `assert-in-handler` | natural（uq_file_object_client_token_store, uq_file_object_client_token_noscope） | V1.0 | 3.21 |
| `m.file.get` | GET | `/m/files/{fileId}` | 查询文件入库状态 | — | none | V1.0 | 3.22 |
| `m.file.cancel` | POST | `/m/files/{fileId}/cancel` | 取消上传（未入库的登记作废） | — | required | V1.0 | 3.25 |
| `m.file.complete` | POST | `/m/files/{fileId}/complete` | 上传确认（小文件最多等 3 秒入库），业务提交时再引用 fileId | — | required | V1.0 | 3.23 |
| `m.file.refreshCredentials` | POST | `/m/files/{fileId}/refresh-credentials` | 续签分块上传的临时密钥（30 分钟有效） | — | none | V1.0 | 3.24 |
| `m.me.overview.get` | GET | `/m/me/overview` | “我的”页聚合：当前门店卡（认证状态、城市品类、角色、档案摘要、审核中提示）、套餐与积分卡（仅老板）、我的门店数与额度、当前门店概览（上线中/交付中/选剧单）、各入口副标题与角标 | `me.*` | none | V1.0 | 3.3 |
| `m.message.list` | GET | `/m/messages` | 站内消息（?tab=&cursor=，游标分页）：分类、标题、正文、按钮文案、深链、未读标记；按今天/昨天/日期分组 | `assert-in-handler` | none | V1.0 | 3.14 |
| `m.message.batchRead` | POST | `/m/messages/read` | 全部已读 {tab?, upToMessageId} → {markedCount, summary} | `assert-in-handler` | required | V1.0 | 3.16 |
| `m.message.summary` | GET | `/m/messages/summary` | 未读计数：total、byTab（数组 [{tab, unreadCount}]，tab 取值与列表一致）、byStore（[{storeId, unreadCount}]） | `assert-in-handler` | none | V1.0 | 3.15 |
| `m.message.read` | POST | `/m/messages/{messageId}/read` | 标记单条已读（点击消息跳转时） | `assert-in-handler` | required | V1.0 | 3.17 |
| `m.notifySetting.list` | GET | `/m/notify-settings` | 通知设置：各类订阅消息（审核结果、付款结果、到期提醒、交付进度、待办提醒、工单回复、开票结果等槽位）的当前状态与可请求的模板 id | — | none | V1.0 | 3.19 |
| `m.serviceManager.get` | GET | `/m/service-manager` | 当前门店的专属服务经理名片：姓名、岗位、企业微信“联系我”二维码、电话、工作时间 | `support.manager.read` | none | V1.0 | 3.4 |
| `m.serviceTicket.list` | GET | `/m/service-tickets` | 我的工单：类型、状态、标题、日期、关联订单 | `ticket.*` | none | V1.0 | 3.5 |
| `m.serviceTicket.create` | POST | `/m/service-tickets` | 提交工单：{typeCode, orderId?, description ≤500, imageFileIds ≤9, phoneSource, contactPhone?}；取号 KF…，轮流分配当班客服 | `ticket.*` | required | V1.0 | 3.6 |
| `m.serviceTicket.get` | GET | `/m/service-tickets/{serviceTicketId}` | 工单详情：工单号、状态与进度条、类型、关联订单、处理人、自动解决时刻；处理记录（只含商家可见条目，系统事件带深链按钮） | `ticket.*` | none | V1.0 | 3.7 |
| `m.serviceTicket.confirm` | POST | `/m/service-tickets/{serviceTicketId}/confirm` | 确认已解决 | `ticket.*` | required | V1.0 | 3.9 |
| `m.serviceTicket.entry.create` | POST | `/m/service-tickets/{serviceTicketId}/entries` | 补充说明（≤500 字、1 张图），提醒处理人 | `ticket.*` | required | V1.0 | 3.8 |
| `m.serviceTicket.rate` | POST | `/m/service-tickets/{serviceTicketId}/rate` | V1.1：工单解决后评价服务（1～5 星） | `ticket.*` | required | V1.1 | 3.12 |
| `m.serviceTicket.reopen` | POST | `/m/service-tickets/{serviceTicketId}/reopen` | 仍未解决、重新打开 {note}（待您确认，或已解决不超过参数天数） | `ticket.*` | required | V1.0 | 3.10 |
| `m.serviceTicket.withdraw` | POST | `/m/service-tickets/{serviceTicketId}/withdraw` | 撤回工单 {reasonCode}（问题已解决/不再需要/重复提交/其他） | `ticket.*` | required | V1.0 | 3.11 |
| `m.siteNotice.list` | GET | `/m/site-notices` | V1.1：消息中心“公告”页签（系统通知、活动、规则变更） | — | none | V1.1 | 3.18 |
| `m.subscribeResult.create` | POST | `/m/subscribe-results` | 订阅消息授权结果上报：{reportId, point, results: [{tmplId, accept\|reject\|ban\|filter}]} | — | required | V1.0 | 3.20 |

## 运营管理后台

### [后台：登录、员工、权限与系统](a01-system.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.alert.list` | GET | `/admin/alerts` | 未恢复告警列表（状态、级别、来源、认领人） | `assert-in-handler` | none | V1.0 | 3.70 |
| `admin.alert.acknowledge` | POST | `/admin/alerts/{alertId}/acknowledge` | 认领告警 | `sys.health.manage` | required | V1.0 | 3.71 |
| `admin.alert.resolve` | POST | `/admin/alerts/{alertId}/resolve` | 人工关闭告警（必填说明，不发通知） | `sys.health.manage` | required | V1.0 | 3.72 |
| `admin.approval.list` | GET | `/admin/approvals` | 审批单列表（跨类型、只读）：按 kind 与页签查询；不带 kind 时为“我的待审批”（待本人决定的各类审批） | `assert-in-handler` | none | V1.0 | 3.36 |
| `admin.approval.summary` | GET | `/admin/approvals/summary` | 各 kind 的待办计数、超时数与本月合计（如本月通过的调整积分增减合计） | `assert-in-handler` | none | V1.0 | 3.37 |
| `admin.approval.get` | GET | `/admin/approvals/{approvalId}` | 审批单详情（只读）：摘要快照、决定记录与时限、领域行引用（domain.type / domain.id） | `assert-in-handler` | none | V1.0 | 3.38 |
| `admin.assignmentPoolMember.list` | GET | `/admin/assignment-pool-members` | 分配池成员：交付经理（按城市）、剪辑师、发布专员、客服（含当班开关） | `assert-in-handler` | none | V1.0 | 3.28 |
| `admin.auditLog.list` | GET | `/admin/audit-logs` | 操作日志列表：时间范围、类型、操作人（含“系统”），游标分页 | `assert-in-handler` | none | V1.0 | 3.39 |
| `admin.auditLog.get` | GET | `/admin/audit-logs/{auditLogId}` | 操作日志详情：键值、变更前后、登录方式、来源 IP（脱敏）、关联页面 | `assert-in-handler` | none | V1.0 | 3.40 |
| `admin.auth.activate` | POST | `/admin/auth/activate` | 新员工或被重置的员工凭短信激活码换取设置密码票据 | — | none | V1.0 | 3.3 |
| `admin.auth.bindWecom` | POST | `/admin/auth/bind-wecom` | 员工本人扫码绑定企业微信 | — | required | V1.0 | 3.10 |
| `admin.auth.changePassword` | POST | `/admin/auth/change-password` | 修改本人登录密码 | — | required | V1.0 | 3.9 |
| `admin.auth.confirmTotp` | POST | `/admin/auth/confirm-totp` | 校验一次动态口令完成绑定，生成 10 个恢复码（只显示一次）并建会话 | — | none | V1.0 | 3.6 |
| `admin.auth.enrollTotp` | POST | `/admin/auth/enroll-totp` | 生成动态口令密钥，返回 otpauth 地址供扫码绑定 | — | none | V1.0 | 3.5 |
| `admin.auth.login` | POST | `/admin/auth/login` | 手机号 + 密码登录第一步，返回第二因子票据 | — | none | V1.0 | 3.1 |
| `admin.session.current.delete` | DELETE | `/admin/sessions/current` | 退出登录：吊销当前会话（当前会话视图别名，A41） | — | none | V1.0 | 3.11 |
| `admin.auth.me.get` | GET | `/admin/auth/me` | 当前员工、模块等级、已开启的权限点、是否主管、数据范围（驱动菜单、路由守卫、按钮显隐） | — | none | V1.0 | 3.8 |
| `admin.auth.setPassword` | POST | `/admin/auth/set-password` | 凭设置密码票据设置登录密码（首次登录、重置后） | — | none | V1.0 | 3.4 |
| `admin.auth.stepUp` | POST | `/admin/auth/step-up` | 敏感操作前的再验证（动态口令），成功后前端自动重放原请求 | — | none | V1.0 | 3.7 |
| `admin.auth.verifyMfa` | POST | `/admin/auth/verify-mfa` | 校验 6 位动态口令或恢复码，建立员工会话 | — | none | V1.0 | 3.2 |
| `admin.calendarDay.list` | GET | `/admin/calendar-days` | 某年的工作日历（放假、调休上班），参数页的节假日表 | — | none | V1.0 | 3.49 |
| `admin.calendarDay.batchImport` | POST | `/admin/calendar-days/import` | 导入年度放假安排（按年幂等；有变化才升日历批次并重算各类工作日时限） | `sys.param.edit` | required | V1.0 | 3.50 |
| `admin.checklistTemplate.list` | GET | `/admin/checklist-templates` | 清单模板：质检、交付前检查、链接核验、账号核验、巡检、下架核查（按编码取当前启用版本或全部版本） | `assert-in-handler` | none | V1.0 | 3.53 |
| `admin.checklistTemplate.create` | POST | `/admin/checklist-templates` | 新建清单模板版本（草稿） | `flow.checklist.manage` | required | V1.0 | 3.54 |
| `admin.checklistTemplate.activate` | POST | `/admin/checklist-templates/{checklistTemplateId}/activate` | 启用清单模板版本（同编码旧版本退役） | `flow.checklist.manage` | required | V1.0 | 3.55 |
| `admin.checklistTemplate.discard` | POST | `/admin/checklist-templates/{checklistTemplateId}/discard` | 放弃清单模板草稿 | `flow.checklist.manage` | required | V1.0 | 3.56 |
| `admin.clientError.create` | POST | `/admin/client-errors` | 后台前端错误上报转发（同源） | — | none | V1.0 | 3.84 |
| `admin.debug.clientIp.get` | GET | `/admin/debug/client-ip` | 部署核对：回显解析出的客户端 IP | `sys.super_admin` | none | V1.0 | 3.85 |
| `admin.dictItem.list` | GET | `/admin/dict-items` | 字典项：按类型查询（树形，可带引用计数）；后台各处下拉与原因单选共用 | `assert-in-handler` | none | V1.0 | 3.43 |
| `admin.dictItem.create` | POST | `/admin/dict-items` | 新增字典项（编码由系统按顺序生成，保存后不可改；同级不重名） | `sys.dict.edit` | required | V1.0 | 3.44 |
| `admin.dictItem.update` | PATCH | `/admin/dict-items/{dictItemId}` | 修改字典项名称、说明，或启用 / 停用 | `sys.dict.edit` | required | V1.0 | 3.45 |
| `admin.dictType.list` | GET | `/admin/dict-types` | 字典类型列表（项数、启用数、是否可新增） | — | none | V1.0 | 3.42 |
| `admin.featureFlag.list` | GET | `/admin/feature-flags` | 特性开关列表：键、说明、默认值、规则（平台、版本、环境、主体白名单） | `sys.super_admin` | none | V1.0 | 3.51 |
| `admin.featureFlag.update` | PATCH | `/admin/feature-flags/{flagKey}` | 修改开关的默认值或规则（写审计，触发即时播报） | `sys.super_admin` | required | V1.0 | 3.52 |
| `admin.file.list` | GET | `/admin/files` | 文件查询（如已清除、保留期内可恢复的文件） | — | none | V1.0 | 3.62 |
| `admin.file.create` | POST | `/admin/files` | 上传登记（证照代传、发票文件、转账回单、Banner 图、协议正文、样片、广告版本、预告片、核查截图、巡检截图等），返回 fileId 与直传凭证 | `assert-in-handler` | natural（uq_file_object_client_token_store, uq_file_object_client_token_noscope） | V1.0 | 3.57 |
| `admin.file.get` | GET | `/admin/files/{fileId}` | 查询文件入库与体检状态（前端轮询） | `assert-in-handler` | none | V1.0 | 3.60 |
| `admin.file.complete` | POST | `/admin/files/{fileId}/complete` | 上传完成确认，服务端核对对象并入库（触发体检） | `assert-in-handler` | required | V1.0 | 3.59 |
| `admin.file.downloadUrls` | POST | `/admin/files/{fileId}/download-urls` | 签发文件的短时读地址（证照 5 分钟、样片与广告 60 分钟、成片 30 分钟），按分类判权并逐次留痕 | `assert-in-handler` | none | V1.0 | 3.61 |
| `admin.file.erase` | POST | `/admin/files/{fileId}/erase` | 彻底删除文件的全部历史版本 | `files.erase` | required | V1.0 | 3.64 |
| `admin.file.refreshCredentials` | POST | `/admin/files/{fileId}/refresh-credentials` | 续签直传临时密钥（大文件分块上传中途过期） | `assert-in-handler` | none | V1.0 | 3.58 |
| `admin.file.restore` | POST | `/admin/files/{fileId}/restore` | 恢复已清除文件（历史版本保留期内；填写原因） | `files.restore` | required | V1.0 | 3.63 |
| `admin.invariantRun.list` | GET | `/admin/invariant-runs` | 不变量校验运行记录 | — | none | V1.0 | 3.73 |
| `admin.invariantRun.create` | POST | `/admin/invariant-runs` | 手动触发一次不变量校验（可限定主体） | `flow.ops.manage` | required | V1.0 | 3.74 |
| `admin.invariantViolation.list` | GET | `/admin/invariant-violations` | 未解决的不变量违规列表与明细（账本、付款、工单、员工等各模块登记的检查项） | `assert-in-handler` | none | V1.0 | 3.75 |
| `admin.invariantViolation.resolve` | POST | `/admin/invariant-violations/{invariantViolationId}/resolve` | 为一条违规填写处理结论并标记已处理 | `assert-in-handler` | required | V1.0 | 3.76 |
| `admin.mediaJob.list` | GET | `/admin/media-jobs` | 媒体任务监控（失败列表：转码、体检、OCR、打包等） | — | none | V1.0 | 3.68 |
| `admin.mediaJob.retry` | POST | `/admin/media-jobs/{mediaJobId}/retry` | 媒体任务人工重试 | `media.job.retry` | required | V1.0 | 3.69 |
| `admin.outboxDelivery.list` | GET | `/admin/outbox-deliveries` | 出站投递查询：死信与重试中的投递 | `assert-in-handler` | none | V1.0 | 3.80 |
| `admin.outboxEvent.retry` | POST | `/admin/outbox-events/{outboxEventId}/retry` | 把某个出站事件对某订阅者的死信重新投递（body 带 subscriber） | `flow.ops.manage` | required | V1.0 | 3.81 |
| `admin.paramValue.list` | GET | `/admin/param-values` | 系统参数：分组、元数据（类型、范围、单位、默认值）、当前值与待生效值、最近保存人 | — | none | V1.0 | 3.46 |
| `admin.paramValue.replace` | PUT | `/admin/param-values` | 整批保存参数（[{key, value, expectedRev, effectiveFrom?}]，整批乐观锁） | `sys.param.edit` | required | V1.0 | 3.47 |
| `admin.paramValue.withdraw` | POST | `/admin/param-values/{paramValueId}/withdraw` | 撤销一条尚未生效的预约参数值 | `sys.param.edit` | required | V1.0 | 3.48 |
| `admin.piiReveal.create` | POST | `/admin/pii-reveals` | 查看字段明文（手机号、信用代码、银行账号等）：先写 access 审计再返回；限频 | `assert-in-handler` | none | V1.0 | 3.41 |
| `admin.purgeRun.list` | GET | `/admin/purge-runs` | 文件清除运行的待确认清单（上线初期人工放行） | — | none | V1.0 | 3.65 |
| `admin.purgeRun.approve` | POST | `/admin/purge-runs/{purgeRunId}/approve` | 放行一次清除运行 | `files.purge.approve` | required | V1.0 | 3.66 |
| `admin.purgeRun.reject` | POST | `/admin/purge-runs/{purgeRunId}/reject` | 驳回一次清除运行 | `files.purge.approve` | required | V1.0 | 3.67 |
| `admin.role.list` | GET | `/admin/roles` | 8 个内置角色：名称、职责、成员数、是否锁定、未保存标记由前端维护 | — | none | V1.0 | 3.32 |
| `admin.role.get` | GET | `/admin/roles/{roleKey}` | 角色详情：13 个模块等级、按角色预置的敏感权限点（含“仅主管”）、数据范围 | — | none | V1.0 | 3.33 |
| `admin.role.replace` | PUT | `/admin/roles/{roleKey}` | 保存角色权限（整体替换，带 lockVersion），员工刷新页面后生效 | `sys.role.edit` | required | V1.0 | 3.35 |
| `admin.role.defaults.get` | GET | `/admin/roles/{roleKey}/defaults` | 角色的代码默认配置（“恢复默认”回填用，保存后才生效） | — | none | V1.0 | 3.34 |
| `admin.staff.list` | GET | `/admin/staff` | 员工列表与选人下拉：员工页按姓名、角色、状态筛选；选人模式按池给候选，标出轮询推荐与按来源的在办量 | `assert-in-handler` | none | V1.0 | 3.12 |
| `admin.staff.create` | POST | `/admin/staff` | 新增员工（立即启用或暂不启用），生成激活码并经短信下发 | `sys.staff.manage` | required | V1.0 | 3.14 |
| `admin.staffGroup.list` | GET | `/admin/staff-groups` | 员工分组列表（编辑员工时选分组；“本组”数据范围的组织实体） | — | none | V1.0 | 3.29 |
| `admin.staffSession.list` | GET | `/admin/staff-sessions` | 在线会话列表 | `sys.session.revoke` | none | V1.0 | 3.30 |
| `admin.staffSession.revoke` | POST | `/admin/staff-sessions/{staffSessionId}/revoke` | 强制下线某个会话 | `sys.session.revoke` | required | V1.0 | 3.31 |
| `admin.staff.get` | GET | `/admin/staff/{staffId}` | 员工详情（编辑弹层回显、所在分配池、企业微信绑定状态） | — | none | V1.0 | 3.13 |
| `admin.staff.update` | PATCH | `/admin/staff/{staffId}` | 编辑员工：姓名、角色、主管标记、分组（手机号不可改） | `sys.staff.manage` | required | V1.0 | 3.15 |
| `admin.staff.bindWecom` | POST | `/admin/staff/{staffId}/bind-wecom` | 手工录入员工的企业微信 userid（兜底方式，V1.0 默认） | `sys.staff.wecom_bind` | required | V1.0 | 3.25 |
| `admin.staff.disable` | POST | `/admin/staff/{staffId}/disable` | 禁用员工：在办事项移交给同角色启用员工，吊销会话，移出分配池 | `sys.staff.secure_ops` | required | V1.0 | 3.17 |
| `admin.staff.duty.update` | PATCH | `/admin/staff/{staffId}/duty` | 切换客服“当班 / 接单中”开关 | `assert-in-handler` | required | V1.0 | 3.27 |
| `admin.staff.enable` | POST | `/admin/staff/{staffId}/enable` | 启用员工（待启用或已禁用），重置密码并下发激活码 | `sys.staff.manage` | required | V1.0 | 3.16 |
| `admin.staff.handover` | POST | `/admin/staff/{staffId}/handover` | 只移交在办事项、不禁用（调岗、长假） | `sys.staff.manage` | required | V1.0 | 3.19 |
| `admin.staff.inviteWecom` | POST | `/admin/staff/{staffId}/invite-wecom` | 发送企业微信绑定邀请（原型“邀请”按钮） | `sys.staff.wecom_bind` | required | V1.0 | 3.24 |
| `admin.staff.openWork.get` | GET | `/admin/staff/{staffId}/open-work` | 名下在办事项摘要（禁用、移交弹层用）：门店、工单、广告、客服工单、跟进待办 | `sys.staff.manage` | none | V1.0 | 3.18 |
| `admin.staff.poolMembership.replace` | PUT | `/admin/staff/{staffId}/pool-memberships` | 设置员工所在的分配池与城市（整体替换） | `sys.staff.manage` | required | V1.0 | 3.26 |
| `admin.staff.reissueActivationCode` | POST | `/admin/staff/{staffId}/reissue-activation-code` | 重新生成激活码（只返回这一次） | `sys.staff.manage` | required | V1.0 | 3.22 |
| `admin.staff.resetMfa` | POST | `/admin/staff/{staffId}/reset-mfa` | 重置第二因子：清空动态口令与密码、吊销会话、下发新激活码 | `sys.staff.secure_ops` | required | V1.0 | 3.21 |
| `admin.staff.resetPassword` | POST | `/admin/staff/{staffId}/reset-password` | 重置登录密码：原密码与全部会话立即失效，下发重置码 | `sys.staff.secure_ops` | required | V1.0 | 3.20 |
| `admin.staff.unlock` | POST | `/admin/staff/{staffId}/unlock` | 解除登录锁定 | `sys.staff.manage` | required | V1.0 | 3.23 |
| `admin.timer.list` | GET | `/admin/timers` | 定时器查询：失败、待触发，按对象类型与 id 过滤 | `assert-in-handler` | none | V1.0 | 3.77 |
| `admin.timer.cancel` | POST | `/admin/timers/{timerId}/cancel` | 把失败的定时器标记为不再需要（原因必填，写审计） | `flow.ops.manage` | required | V1.0 | 3.79 |
| `admin.timer.reschedule` | POST | `/admin/timers/{timerId}/reschedule` | 定时器重新排期（失败或需改期的定时器） | `flow.ops.manage` | required | V1.0 | 3.78 |
| `admin.webhookEvent.list` | GET | `/admin/webhook-events` | 回调收件箱查询（失败、死信） | `assert-in-handler` | none | V1.0 | 3.82 |
| `admin.webhookEvent.retry` | POST | `/admin/webhook-events/{webhookEventId}/retry` | 把死信回调重置为待处理（attempts 清零） | `flow.ops.manage` | required | V1.0 | 3.83 |
| `admin.auth.me.enrollTotp` | POST | `/admin/auth/me/enroll-totp` | 本人重新绑定动态口令：生成新的待确认密钥（用户菜单“动态口令设置”） | `self.mfa.reset` | none | V1.0 | 3.86 |
| `admin.auth.me.confirmTotp` | POST | `/admin/auth/me/confirm-totp` | 本人重新绑定动态口令：校验新密钥的口令后替换密钥、换发 10 个恢复码、吊销本人其他会话 | `self.mfa.reset` | required | V1.0 | 3.87 |
| `admin.staff.summary` | GET | `/admin/staff/summary` | 员工计数：共 N 个账号 · 启用 · 待启用 · 已禁用（另给待激活、锁定人数） | — | none | V1.0 | 3.88 |
| `admin.file.cancel` | POST | `/admin/files/{fileId}/cancel` | 上传人本人取消未确认的上传登记（pending → expired，清空写入区键） | `assert-in-handler` | required | V1.0 | 3.89 |

### [后台：工作台、报表与导出](a02-workbench-report.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.exportJob.list` | GET | `/admin/export-jobs` | 我的导出记录（页头“导出记录”抽屉） | — | none | V1.0 | 3.16 |
| `admin.exportJob.create` | POST | `/admin/export-jobs` | 申请导出（按当前筛选条件，异步生成 CSV 或 XLSX；同参数进行中任务返回同一个） | `assert-in-handler` | natural（uq_export_job_inflight） | V1.0 | 3.15 |
| `admin.exportJob.get` | GET | `/admin/export-jobs/{exportJobId}` | 导出任务状态（前端每 2 秒轮询，至多 2 分钟） | — | none | V1.0 | 3.17 |
| `admin.exportJob.cancel` | POST | `/admin/export-jobs/{exportJobId}/cancel` | 取消排队中的导出任务 | — | required | V1.0 | 3.18 |
| `admin.exportJob.downloadUrls` | POST | `/admin/export-jobs/{exportJobId}/download-urls` | 签发 5 分钟下载地址（申请人本人；复核仍有该导出权限，不通过则置过期并返回 status = revoked；记下载审计） | `assert-in-handler` | none | V1.0 | 3.19 |
| `admin.navBadge.get` | GET | `/admin/nav-badges` | 菜单与二级菜单待办角标（全部后台页面的外壳共用） | — | none | V1.0 | 3.5 |
| `admin.reportMonthClose.list` | GET | `/admin/report-month-closes` | 报表月度快照（历史月数据来源与“已结算”标记） | — | none | V1.0 | 3.13 |
| `admin.reportMonthClose.reissue` | POST | `/admin/report-month-closes/{reportMonthCloseId}/reissue` | 重出某月快照（续率定稿或口径修正），旧快照置 superseded | `report.month_close.reissue` | required | V1.0 | 3.14 |
| `admin.report.ads.get` | GET | `/admin/reports/ads` | 广告制作（新广告、消耗积分、修改次数、首版按时率、复用率、按剪辑师） | — | none | V1.1 | 3.22 |
| `admin.report.delivery.get` | GET | `/admin/reports/delivery` | 交付效率（交付时长中位数、按时上线率、样片一次通过率、环节用时、按交付经理） | — | none | V1.1 | 3.21 |
| `admin.report.dramas.get` | GET | `/admin/reports/dramas` | 短剧销售排行（订购次数、消耗积分、订购商家；热度等级分布；授权期提醒） | — | none | V1.1 | 3.20 |
| `admin.report.overview.get` | GET | `/admin/reports/overview` | 经营概览：MRR、收款额、付费主体、新开通与续费、续费率、积分消耗、订购部数；每日收款、近 6 月 MRR、收款构成、付费主体分布 | — | none | V1.0 | 3.11 |
| `admin.report.partners.get` | GET | `/admin/reports/partners` | 服务商业绩（名下商家、名下实付、返佣） | — | none | V1.1 | 3.24 |
| `admin.report.points.get` | GET | `/admin/reports/points` | 积分报表：积分负债与折合预收款、发放、加购、消耗、清零、退回；流转、近 6 月、按来源 | — | none | V1.0 | 3.12 |
| `admin.report.service.get` | GET | `/admin/reports/service` | 客服报表（工单量、首次响应、方案按时率、解决率、满意度、按客服） | — | none | V1.1 | 3.23 |
| `admin.search.get` | GET | `/admin/search` | 全局搜索：单号前缀匹配、门店名与主体名包含匹配（按类型分组，每组至多 5 条） | — | none | V1.0 | 3.6 |
| `admin.staffMessage.list` | GET | `/admin/staff-messages` | 后台铃铛：员工站内消息列表 | — | none | V1.0 | 3.7 |
| `admin.staffMessage.batchRead` | POST | `/admin/staff-messages/read` | 全部标记已读 | — | required | V1.0 | 3.10 |
| `admin.staffMessage.summary` | GET | `/admin/staff-messages/summary` | 后台铃铛未读数（按消息类别分组） | — | none | V1.0 | 3.8 |
| `admin.staffMessage.read` | POST | `/admin/staff-messages/{staffMessageId}/read` | 标记一条站内消息已读 | — | required | V1.0 | 3.9 |
| `admin.workbench.alert.get` | GET | `/admin/workbench/alerts` | 预警：超时工单、逾期未上线、逾期未下架、版权即将到期，每条带跳转目标 | — | none | V1.0 | 3.3 |
| `admin.workbench.feed.list` | GET | `/admin/workbench/feed` | 实时动态：按时间倒序的审计日志活动流（ops、activity 两流中与商家相关的行），游标分页带 totalApprox | — | none | V1.0 | 3.4 |
| `admin.workbench.today.get` | GET | `/admin/workbench/today` | 今日数据卡片：新增商家、今日订购与冻结积分、今日收款、套餐生效商家（带“数据更新于”时间） | — | none | V1.0 | 3.2 |
| `admin.workbench.todo.get` | GET | `/admin/workbench/todos` | 我的待办：按岗位视角聚合各队列计数与一条副指标（最早时间、金额合计、最近截止、超时数） | — | none | V1.0 | 3.1 |

### [后台：商家、资质审核与素材复核](a03-merchant.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.accountChangeRequest.list` | GET | `/admin/account-change-requests` | 账号类变更申请（换绑手机号、老板更换、老板复核）列表 | — | none | V1.0 | 3.17 |
| `admin.accountChangeRequest.create` | POST | `/admin/account-change-requests` | 客服发起换绑手机号、老板更换、老板复核（同事务建审批单） | `merchant.account_change.request` | required | V1.0 | 3.18 |
| `admin.accountChangeRequest.get` | GET | `/admin/account-change-requests/{accountChangeRequestId}` | 账号类变更申请详情（新手机号脱敏、证明材料、核实记录） | — | none | V1.0 | 3.19 |
| `admin.accountChangeRequest.approve` | POST | `/admin/account-change-requests/{accountChangeRequestId}/approve` | 通过账号类变更（换绑手机号、老板更换、老板复核），同事务生效 | `merchant.account_change.approve` | required | V1.0 | 3.20 |
| `admin.accountChangeRequest.reject` | POST | `/admin/account-change-requests/{accountChangeRequestId}/reject` | 驳回账号类变更（说明必填） | `merchant.account_change.approve` | required | V1.0 | 3.21 |
| `admin.accountChangeRequest.withdraw` | POST | `/admin/account-change-requests/{accountChangeRequestId}/withdraw` | 撤回账号类变更申请（提交人本人；发起人已停用时由决定权限点持有人代撤） | `assert-in-handler` | required | V1.0 | 3.22 |
| `admin.assetDemand.list` | GET | `/admin/asset-demands` | 素材需求列表（门店素材页签上方）：标题、说明、发起人、完成时间、已收到条数、状态 | — | none | V1.0 | 3.37 |
| `admin.assetDemand.create` | POST | `/admin/asset-demands` | 发起素材需求（名称、拍摄说明、完成日期、通知对象），通知老板与店员 | `merchant.asset.demand.create` | required | V1.0 | 3.38 |
| `admin.assetDemand.cancel` | POST | `/admin/asset-demands/{assetDemandId}/cancel` | 撤销素材需求 | `merchant.asset.demand.create` | required | V1.0 | 3.40 |
| `admin.assetDemand.complete` | POST | `/admin/asset-demands/{assetDemandId}/complete` | 标记素材需求完成 | `merchant.asset.demand.create` | required | V1.0 | 3.39 |
| `admin.assignmentHistory.markContacted` | POST | `/admin/assignment-histories/{assignmentHistoryId}/mark-contacted` | 新交付经理标记“已联系商家”（关闭联系时限） | `assert-in-handler` | required | V1.0 | 3.9 |
| `admin.commissionStatement.list` | GET | `/admin/commission-statements` | 返佣结算单列表（按月份、状态；当月为预估） | — | none | V1.1 | 3.50 |
| `admin.commissionStatement.summary` | GET | `/admin/commission-statements/summary` | 结算单月度汇总卡（应付、已打款、待打款、异议） | — | none | V1.1 | 3.50 |
| `admin.commissionStatement.get` | GET | `/admin/commission-statements/{commissionStatementId}` | 结算单详情与处理记录 | — | none | V1.1 | 3.50 |
| `admin.commissionStatement.line.list` | GET | `/admin/commission-statements/{commissionStatementId}/lines` | 结算明细（付款单逐笔） | — | none | V1.1 | 3.50 |
| `admin.commissionStatement.recordPayout` | POST | `/admin/commission-statements/{commissionStatementId}/record-payout` | 登记服务商返佣打款（转账日期、银行流水号、回单；通知服务商） | — | required | V1.1 | 3.50 |
| `admin.commissionStatement.replyDispute` | POST | `/admin/commission-statements/{commissionStatementId}/reply-dispute` | 回复服务商异议并重新推送确认 | — | required | V1.1 | 3.50 |
| `admin.entity.get` | GET | `/admin/entities/{entityId}` | 主体卡片与名下门店（门店与成员页签）：信用代码脱敏、认证日期、老板、套餐、门店与成员用量 | — | none | V1.0 | 3.10 |
| `admin.entity.close` | POST | `/admin/entities/{entityId}/close` | 后台关闭经营主体：撤回邀请、移除成员、停用门店、吊销下载页会话 | `merchant.entity.close` | required | V1.0 | 3.13 |
| `admin.entity.member.list` | GET | `/admin/entities/{entityId}/members` | 主体成员（只读：成员由老板在小程序邀请和管理；待接受的邀请随 admin.entity.get 返回） | — | none | V1.0 | 3.11 |
| `admin.entity.quota.update` | PATCH | `/admin/entities/{entityId}/quota` | 门店数、成员数上限覆盖（大客户） | `merchant.quota.override` | required | V1.0 | 3.12 |
| `admin.followUp.list` | GET | `/admin/follow-ups` | 跟进记录：按对象（门店、续费周期、逾期订单项、巡检、下架、补发）或主体、门店查询时间线 | `assert-in-handler` | none | V1.0 | 3.41 |
| `admin.followUp.create` | POST | `/admin/follow-ups` | 记录跟进：方式、内容、续费意向（仅续费）、下次跟进时间；同对象此前在办的跟进同事务关闭 | `assert-in-handler` | required | V1.0 | 3.42 |
| `admin.followUp.summary` | GET | `/admin/follow-ups/summary` | 跟进记录计数（商家详情“跟进记录”页签角标） | `assert-in-handler` | none | V1.1 | 3.45 |
| `admin.followUp.update` | PATCH | `/admin/follow-ups/{followUpId}` | 改下次跟进时间（带 lockVersion） | `assert-in-handler` | required | V1.0 | 3.43 |
| `admin.followUp.complete` | POST | `/admin/follow-ups/{followUpId}/complete` | 标记跟进事项完成（可填完成说明） | `assert-in-handler` | required | V1.0 | 3.44 |
| `admin.merchantUser.disable` | POST | `/admin/merchant-users/{merchantUserId}/disable` | 禁用商家账号（原因必填；吊销全部会话） | `merchant.user.disable` | required | V1.0 | 3.14 |
| `admin.merchantUser.enable` | POST | `/admin/merchant-users/{merchantUserId}/enable` | 启用商家账号 | `merchant.user.disable` | required | V1.0 | 3.15 |
| `admin.merchantUser.forceLogout` | POST | `/admin/merchant-users/{merchantUserId}/force-logout` | 强制下线商家账号（吊销会话与下载页会话，关闭静默登录） | `merchant.user.force_logout` | required | V1.0 | 3.16 |
| `admin.partnerApplication.list` | GET | `/admin/partner-applications` | 服务商入驻申请队列 | — | none | V1.1 | 3.50 |
| `admin.partnerApplication.get` | GET | `/admin/partner-applications/{partnerApplicationId}` | 入驻申请详情（证照比对、申请信息） | — | none | V1.1 | 3.50 |
| `admin.partnerApplication.approve` | POST | `/admin/partner-applications/{partnerApplicationId}/approve` | 入驻审核通过（指派渠道运营，推送合作协议在线签署） | — | required | V1.1 | 3.50 |
| `admin.partnerApplication.reject` | POST | `/admin/partner-applications/{partnerApplicationId}/reject` | 驳回入驻申请（原因 + 说明） | — | required | V1.1 | 3.50 |
| `admin.partnerBindingChange.list` | GET | `/admin/partner-binding-changes` | 归属变更申请列表 | — | none | V1.1 | 3.50 |
| `admin.partnerBindingChange.approve` | POST | `/admin/partner-binding-changes/{partnerBindingChangeId}/approve` | 通过归属变更（次日 00:00 生效，通知三方） | — | required | V1.1 | 3.50 |
| `admin.partnerBindingChange.reject` | POST | `/admin/partner-binding-changes/{partnerBindingChangeId}/reject` | 驳回归属变更（须填原因） | — | required | V1.1 | 3.50 |
| `admin.partnerBinding.list` | GET | `/admin/partner-bindings` | 商家归属记录（分页） | — | none | V1.1 | 3.50 |
| `admin.partnerLevelChange.list` | GET | `/admin/partner-level-changes` | 等级评定、手动调整、比例配置的变更记录 | — | none | V1.1 | 3.50 |
| `admin.partnerLevel.list` | GET | `/admin/partner-levels` | 服务商等级、返佣比例与评定标准 | — | none | V1.1 | 3.50 |
| `admin.partnerLevel.replace` | PUT | `/admin/partner-levels/{levelKey}` | 编辑等级比例、门槛与生效时间（立即或下月 1 日） | — | required | V1.1 | 3.50 |
| `admin.partner.list` | GET | `/admin/partners` | 服务商列表（区域、等级、状态；名下商家、本月名下实付、返佣） | — | none | V1.1 | 3.50 |
| `admin.partner.get` | GET | `/admin/partners/{partnerId}` | 服务商详情与本月成交前三的商家 | — | none | V1.1 | 3.50 |
| `admin.partner.adjustLevel` | POST | `/admin/partners/{partnerId}/adjust-level` | 手动调整服务商等级（须填原因） | — | required | V1.1 | 3.50 |
| `admin.partner.pause` | POST | `/admin/partners/{partnerId}/pause` | 暂停合作（须填原因，通知服务商） | — | required | V1.1 | 3.50 |
| `admin.partner.resume` | POST | `/admin/partners/{partnerId}/resume` | 恢复合作 | — | required | V1.1 | 3.50 |
| `admin.qualificationDoc.update` | PATCH | `/admin/qualification-docs/{qualificationDocId}` | 审核员修正识别字段并重跑系统比对（OCR 误识别时的出口） | `merchant.qualification.review` | required | V1.0 | 3.24 |
| `admin.qualificationSubmission.get` | GET | `/admin/qualification-submissions/{qualificationSubmissionId}` | 资质提交详情（审核页右栏）：本轮证照与识别字段（脱敏）、系统比对结论、修正记录、历次审核与审批单引用 | — | none | V1.0 | 3.23 |
| `admin.qualificationSubmission.approve` | POST | `/admin/qualification-submissions/{qualificationSubmissionId}/approve` | 资质审核通过（initial 轮次门店与主体认证生效；change 轮次保持已认证） | `merchant.qualification.review` | required | V1.0 | 3.26 |
| `admin.qualificationSubmission.reject` | POST | `/admin/qualification-submissions/{qualificationSubmissionId}/reject` | 资质驳回或退回补充：原因（字典 reject_reason）+ 说明；可指明被驳回的证照行；可选终局驳回 | `merchant.qualification.review` | required | V1.0 | 3.27 |
| `admin.qualificationSubmission.rejectQuote` | POST | `/admin/qualification-submissions/{qualificationSubmissionId}/reject-quote` | 终局驳回的影响预览：冻结中的订购、广告将整店取消并退回积分 | `merchant.qualification.review` | none | V1.0 | 3.25 |
| `admin.referralCode.list` | GET | `/admin/referral-codes` | 渠道码与邀请码登记列表 | — | none | V1.0 | 3.46 |
| `admin.referralCode.create` | POST | `/admin/referral-codes` | 登记渠道码（销售、活动） | `merchant.referral_code.manage` | required | V1.0 | 3.47 |
| `admin.referralCode.disable` | POST | `/admin/referral-codes/{referralCodeId}/disable` | 停用渠道码（停用后不再归因） | `merchant.referral_code.manage` | required | V1.0 | 3.48 |
| `admin.referralCode.enable` | POST | `/admin/referral-codes/{referralCodeId}/enable` | 重新启用渠道码 | `merchant.referral_code.manage` | required | V1.0 | 3.49 |
| `admin.storeAsset.list` | GET | `/admin/store-assets` | 门店素材列表：按复核状态（待整理）、是否已采用、类型筛选，按上传时间倒序 | — | none | V1.0 | 3.28 |
| `admin.storeAsset.create` | POST | `/admin/store-assets` | 员工代商家上传素材 | `merchant.asset.upload_on_behalf` | required | V1.0 | 3.31 |
| `admin.storeAsset.summary` | GET | `/admin/store-assets/summary` | 门店素材计数：按复核状态与类型（商家详情“门店素材”页签角标与类型筛选的计数） | — | none | V1.0 | 3.29 |
| `admin.storeAsset.get` | GET | `/admin/store-assets/{storeAssetId}` | 素材详情：文件组预览地址、系统识别结果（转写、要点、标签、人脸）、使用记录 | — | none | V1.0 | 3.30 |
| `admin.storeAsset.confirmPortraitAuth` | POST | `/admin/store-assets/{storeAssetId}/confirm-portrait-auth` | 确认肖像授权齐全，可用性改为可直接使用或仅供参考 | `merchant.asset.review` | required | V1.0 | 3.33 |
| `admin.storeAsset.delete` | POST | `/admin/store-assets/{storeAssetId}/delete` | 后台软删除素材（写 deleted_at，7 天后清除文件；原因必填，写审计） | `merchant.asset.review` | required | V1.0 | 3.36 |
| `admin.storeAsset.portraitAuth.create` | POST | `/admin/store-assets/{storeAssetId}/portrait-auth` | 员工代商家补交肖像授权材料（文件分类 portrait_auth，追加到 portrait_auth_file_ids） | `merchant.asset.upload_on_behalf` | required | V1.0 | 3.34 |
| `admin.storeAsset.reprocess` | POST | `/admin/store-assets/{storeAssetId}/reprocess` | 素材重新识别（转写、打标） | `merchant.asset.review` | required | V1.0 | 3.35 |
| `admin.storeAsset.review` | POST | `/admin/store-assets/{storeAssetId}/review` | 整理素材：内容标签、用途、时效、可用性（需补拍、需肖像授权时提醒上传人），带 lockVersion | `merchant.asset.review` | required | V1.0 | 3.32 |
| `admin.store.list` | GET | `/admin/stores` | 商家（门店）列表：关键字、区域、行业、审核状态、来源、交付经理、套餐版本、到期；排序与分页；也用于门店远程搜索下拉 | — | none | V1.0 | 3.1 |
| `admin.store.summary` | GET | `/admin/stores/summary` | 商家列表页头统计：共 N 家、付费、套餐生效、审核中、本月新增 | — | none | V1.0 | 3.2 |
| `admin.store.get` | GET | `/admin/stores/{storeId}` | 商家详情页头：门店、主体、标签、联系人（脱敏）、交付经理、5 张 KPI 卡 | — | none | V1.0 | 3.3 |
| `admin.store.activity.list` | GET | `/admin/stores/{storeId}/activities` | 门店活动流（操作日志页签）：商家、店员、系统、员工的操作与变更 | — | none | V1.0 | 3.4 |
| `admin.store.profile.get` | GET | `/admin/stores/{storeId}/profile` | 档案页签：基本信息、主推服务、门店图片、完整度、最近修改人 | — | none | V1.0 | 3.5 |
| `admin.store.profile.update` | PATCH | `/admin/stores/{storeId}/profile` | 代改档案（免审字段；必选修改原因 + 备注；带 lockVersion；通知商家，修改前后记入日志） | `merchant.profile.proxy_edit` | required | V1.0 | 3.6 |
| `admin.store.qualification.get` | GET | `/admin/stores/{storeId}/qualification` | 资质页签：结论摘要、生效证照与识别字段（脱敏）、历次审核记录 | — | none | V1.0 | 3.7 |
| `admin.store.assignDeliveryManager` | POST | `/admin/stores/{storeId}/assign-delivery-manager` | 首次指派交付经理（门店还没有交付经理时）：写门店交付经理，同步未结订购单，同事务分配本门店的待分配工单 | `merchant.manager.assign` | required | V1.0 | 3.8a |
| `admin.store.reassignDeliveryManager` | POST | `/admin/stores/{storeId}/reassign-delivery-manager` | 转移交付经理：门店与在办工单、订购单、客服工单一并移交（已归档的不动），通知商家，新经理 1 个工作日内联系 | `merchant.manager.transfer` | required | V1.0 | 3.8 |

### [后台：短剧库与积分价](a04-content.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.dramaEpisode.update` | PATCH | `/admin/drama-episodes/{dramaEpisodeId}` | 修改剧集标题 | — | required | V1.0 | 3.17 |
| `admin.dramaPermit.update` | PATCH | `/admin/drama-permits/{dramaPermitId}` | 修改许可行 | — | required | V1.0 | 3.14 |
| `admin.dramaPermit.retire` | POST | `/admin/drama-permits/{dramaPermitId}/retire` | 停用许可行 | — | required | V1.0 | 3.15 |
| `admin.dramaPriceRevision.list` | GET | `/admin/drama-price-revisions` | 调价记录（含待生效、已撤销） | — | none | V1.0 | 3.34 |
| `admin.dramaPriceRevision.withdraw` | POST | `/admin/drama-price-revisions/{dramaPriceRevisionId}/withdraw` | 撤销尚未生效的调价 | `billing.price.edit` | required | V1.0 | 3.35 |
| `admin.dramaPrice.list` | GET | `/admin/drama-prices` | 单剧积分价列表：等级、模板价、积分价、三个版本实扣、授权期、生效时间 | — | none | V1.0 | 3.31 |
| `admin.dramaPrice.summary` | GET | `/admin/drama-prices/summary` | 单剧积分价页首计数：已上架、单剧调整、本月订购；页头上下文带最短可订月数 | — | none | V1.0 | 3.32 |
| `admin.drama.list` | GET | `/admin/dramas` | 短剧列表：剧名、状态、题材、热度、类别、适配行业、“仅看 N 天内授权到期”；每页 12；积分价列含模板价 | — | none | V1.0 | 3.1 |
| `admin.drama.create` | POST | `/admin/dramas` | 新建短剧草稿（同事务建空的版权行） | — | required | V1.0 | 3.3 |
| `admin.drama.summary` | GET | `/admin/dramas/summary` | 页首计数：已上架、草稿、已下架、授权期 90 天内结束且已停止订购 | — | none | V1.0 | 3.2 |
| `admin.drama.get` | GET | `/admin/dramas/{dramaId}` | 短剧详情（5 个页签数据、右栏积分价与上架校验摘要） | — | none | V1.0 | 3.4 |
| `admin.drama.activity.list` | GET | `/admin/dramas/{dramaId}/activities` | 剧目操作日志（右栏） | — | none | V1.0 | 3.5 |
| `admin.drama.basic.update` | PATCH | `/admin/dramas/{dramaId}/basic` | 保存“基础信息”页签（剧名、封面、集数、单集时长、题材、标签、出品方、主演、简介、微短剧类别、是否 AI 制作），带 lockVersion；已上架时重跑校验、商城同步更新 | — | required | V1.0 | 3.7 |
| `admin.drama.commercial.update` | PATCH | `/admin/dramas/{dramaId}/commercial` | 保存“商业信息”页签（热度等级、人工加权、适配行业、目标观众、允许的植入形式、试看集数 V1.1），带 lockVersion | — | required | V1.0 | 3.8 |
| `admin.drama.confirmPermitRecheck` | POST | `/admin/dramas/{dramaId}/confirm-permit-recheck` | 替换原片后确认许可信息仍适用（清除待重新核验标记） | — | required | V1.0 | 3.20 |
| `admin.drama.copyright.replace` | PUT | `/admin/dramas/{dramaId}/copyright` | 草稿期保存版权信息（来源、平台与地域、四项权利、有效期、权属证明） | — | required | V1.0 | 3.10 |
| `admin.drama.delist` | POST | `/admin/dramas/{dramaId}/delist` | 下架（必选原因，说明 ≤200 字；上线中成片使用期不受影响） | `drama.shelf` | required | V1.0 | 3.19 |
| `admin.drama.dramaCopyrightRevision.create` | POST | `/admin/dramas/{dramaId}/drama-copyright-revisions` | 上架后的版权变更（续期、缩短、范围变更、更正），须二次确认与依据文件 | `drama.copyright.revise` | required | V1.0 | 3.11 |
| `admin.drama.dramaEpisode.list` | GET | `/admin/dramas/{dramaId}/drama-episodes` | 剧集列表：标题、时长、当前原片文件与大小、原片状态（缺失、处理中、已就绪），分页 | — | none | V1.0 | 3.16 |
| `admin.drama.dramaPermit.list` | GET | `/admin/dramas/{dramaId}/drama-permits` | 许可信息行（按平台；许可证号、批准文件号、节目编号、扫描件） | — | none | V1.0 | 3.12 |
| `admin.drama.dramaPermit.create` | POST | `/admin/dramas/{dramaId}/drama-permits` | 新增许可行（含许可文件扫描件 fileId） | — | required | V1.0 | 3.13 |
| `admin.drama.dramaPriceRevision.create` | POST | `/admin/dramas/{dramaId}/drama-price-revisions` | 单剧调价：新积分价、生效时间（立即或指定日 00:00）、原因 + 备注；选剧单读取时显示“积分价已变动”（V1.0 不推送） | `billing.price.edit` | required | V1.0 | 3.33 |
| `admin.drama.listingChecks.get` | GET | `/admin/dramas/{dramaId}/listing-checks` | 上架校验结果（N / M 项通过，逐项阻断或提示，带“去补充”定位） | — | none | V1.0 | 3.6 |
| `admin.drama.mediaReadiness.get` | GET | `/admin/dramas/{dramaId}/media-readiness` | 预告片、海报、原片就绪情况（供上架校验与剧集页签） | — | none | V1.0 | 3.21 |
| `admin.drama.cast.replace` | PUT | `/admin/dramas/{dramaId}/cast` | 保存角色介绍（最多 8 个，整表替换，顺序即商家端展示顺序） | — | required | V1.0 | 3.9 |
| `admin.drama.shelve` | POST | `/admin/dramas/{dramaId}/shelve` | 上架或重新上架（服务端重跑校验；按当前状态选迁移 drama.list 或 drama.relist；首次上架写版权 initial 修订、登记授权到期定时器） | `drama.shelf` | required | V1.0 | 3.18 |
| `admin.drama.trailer.replace` | PUT | `/admin/dramas/{dramaId}/trailer` | 设置预告片（fileId；服务端探测时长与画幅，触发两档转码） | `drama.media.manage` | required | V1.0 | 3.22 |
| `admin.priceTierRevision.list` | GET | `/admin/price-tier-revisions` | S / A / B / C 等级模板价：当前值、适用剧目数、按模板定价剧目数 | — | none | V1.0 | 3.36 |
| `admin.uploadBatchItem.update` | PATCH | `/admin/upload-batch-items/{uploadBatchItemId}` | 修改批次条目：集号映射、跳过（仅 partial 批次）、同一集换新文件 | `assert-in-handler` | required | V1.0 | 3.27 |
| `admin.uploadBatchItem.complete` | POST | `/admin/upload-batch-items/{uploadBatchItemId}/complete` | 批次内单个文件上传完成确认 | `assert-in-handler` | required | V1.0 | 3.28 |
| `admin.uploadBatch.create` | POST | `/admin/upload-batches` | 创建批量上传批次并逐集匹配（原片首次上传、批量替换原片；成片批次同用）：用途、目标、文件清单、范围、替换原因、AI 使用声明 | `assert-in-handler` | required | V1.0 | 3.23 |
| `admin.uploadBatch.get` | GET | `/admin/upload-batches/{uploadBatchId}` | 批次详情与逐条进度（前端轮询） | `assert-in-handler` | none | V1.0 | 3.24 |
| `admin.uploadBatch.cancel` | POST | `/admin/upload-batches/{uploadBatchId}/cancel` | 取消批次 | `assert-in-handler` | required | V1.0 | 3.30 |
| `admin.uploadBatch.commit` | POST | `/admin/upload-batches/{uploadBatchId}/commit` | 提交原片批次：生成新原片版本，旧版本置 superseded；内容有实质变更时标记许可待重新核验 | `drama.media.manage` | required | V1.0 | 3.29 |
| `admin.uploadBatch.start` | POST | `/admin/upload-batches/{uploadBatchId}/start` | 确认匹配结果，开始上传 | `assert-in-handler` | required | V1.0 | 3.25 |
| `admin.uploadBatch.refreshCredentials` | POST | `/admin/upload-batches/{uploadBatchId}/refresh-credentials` | 签发或续签整批的直传临时密钥（只能写批次前缀 incoming/b{uploadBatchId}/*，30 分钟） | `assert-in-handler` | none | V1.0 | 3.26 |

### [后台：订购、取消、交付与广告任务](a05-order-delivery.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.adVersion.markSent` | POST | `/admin/ad-versions/{adVersionId}/mark-sent` | 登记已经企业微信向老板发送广告版本（写 offline_sent_at 与发送人；广告视频不加水印） | `delivery.sample.push` | required | V1.0 | 3.57 |
| `admin.adVersion.push` | POST | `/admin/ad-versions/{adVersionId}/push` | 推送广告版本给商家确认（确定查看方式 previewChannels；不可在小程序内播放时须已线下提供） | `delivery.ad.upload` | required | V1.0 | 3.58 |
| `admin.ad.list` | GET | `/admin/ads` | 广告制作任务队列：待处理（待指派、制作中、修改中）、待商家确认、已确认；紧急的排前 | — | none | V1.0 | 3.51 |
| `admin.ad.summary` | GET | `/admin/ads/summary` | 广告制作任务页签计数：待处理（待指派、制作中、修改中）、待商家确认、已确认 | — | none | V1.0 | 3.52 |
| `admin.ad.get` | GET | `/admin/ads/{adId}` | 广告任务详情：需求、关联工单、积分、修改次数、版本与修改记录、预览 | — | none | V1.0 | 3.53 |
| `admin.ad.adVersion.create` | POST | `/admin/ads/{adId}/ad-versions` | 登记第 N 版（文件已上传，竖屏 9:16、1080×1920、标注“广告”）；上传后未推送的旧版本置 superseded | `delivery.ad.upload` | required | V1.0 | 3.56 |
| `admin.ad.assign` | POST | `/admin/ads/{adId}/assign` | 指派剪辑师（默认推荐在办最少者），开始制作并由冻结转扣减积分 | `delivery.ad.assign` | required | V1.0 | 3.54 |
| `admin.ad.cancelQuote` | POST | `/admin/ads/{adId}/cancel-quote` | 广告取消预览（退回积分与账本去向） | `order.refund.request` | none | V1.0 | 3.61 |
| `admin.ad.cancelRequest.create` | POST | `/admin/ads/{adId}/cancel-requests` | 发起广告取消（kind = ad_cancel） | `order.refund.request` | required | V1.0 | 3.62 |
| `admin.ad.remind` | POST | `/admin/ads/{adId}/remind` | 催办商家确认广告（限频） | `assert-in-handler` | required | V1.0 | 3.59 |
| `admin.ad.requestChange` | POST | `/admin/ads/{adId}/request-change` | 交付经理代录广告修改意见（仅免费次数内） | `delivery.sample.feedback_on_behalf` | required | V1.0 | 3.60 |
| `admin.ad.return` | POST | `/admin/ads/{adId}/return` | 退回补充素材（必填原因） | `delivery.ad.return` | required | V1.0 | 3.55 |
| `admin.cancelRequest.list` | GET | `/admin/cancel-requests` | 取消申请列表（订购取消、广告取消、资质相关取消）：页签（待审批、待执行、已处理）、单号、商家、类型 | — | none | V1.0 | 3.8 |
| `admin.cancelRequest.summary` | GET | `/admin/cancel-requests/summary` | 取消申请页签计数与指标：本月退回积分与笔数、审批与执行中、本月驳回 | — | none | V1.0 | 3.9 |
| `admin.cancelRequest.get` | GET | `/admin/cancel-requests/{cancelRequestId}` | 取消申请详情：逐行核算（阶段、已扣、扣除比例、退回）、账本去向、审批与执行结果 | — | none | V1.0 | 3.10 |
| `admin.cancelRequest.approve` | POST | `/admin/cancel-requests/{cancelRequestId}/approve` | 通过取消申请（订购取消、广告取消、资质相关取消），进入待执行 | `finance.refund.approve` | required | V1.0 | 3.11 |
| `admin.cancelRequest.execute` | POST | `/admin/cancel-requests/{cancelRequestId}/execute` | 执行退回积分：积分即时退回、订购单变已退回积分、工单终止（执行后不可撤销） | `finance.refund.execute` | required | V1.0 | 3.15 |
| `admin.cancelRequest.reject` | POST | `/admin/cancel-requests/{cancelRequestId}/reject` | 驳回取消申请（说明必填），关联订购单、广告与工单恢复 | `finance.refund.approve` | required | V1.0 | 3.12 |
| `admin.cancelRequest.void` | POST | `/admin/cancel-requests/{cancelRequestId}/void` | 作废已审批未执行的取消申请（说明必填），工单恢复 | `order.refund.request` | required | V1.0 | 3.14 |
| `admin.cancelRequest.withdraw` | POST | `/admin/cancel-requests/{cancelRequestId}/withdraw` | 撤回尚未审批的取消申请（提交人本人；发起人已停用或对象失效时代撤） | `assert-in-handler` | required | V1.0 | 3.13 |
| `admin.deliveryPlan.get` | GET | `/admin/delivery-plans/{deliveryPlanId}` | 交付方案：当前草稿、已推送版本、商家修改请求 | — | none | V1.0 | 3.34 |
| `admin.deliveryPlan.draft.replace` | PUT | `/admin/delivery-plans/{deliveryPlanId}/draft` | 保存方案草稿：植入形式与广告位、定制重点、发布账号、约定上线日、上线方式（带 draftLockVersion） | `delivery.plan.edit` | required | V1.0 | 3.35 |
| `admin.deliveryPlan.push` | POST | `/admin/delivery-plans/{deliveryPlanId}/push` | 推送方案给商家确认（生成方案版本；从已确认修订时须在变更窗口内） | `delivery.plan.push` | required | V1.0 | 3.36 |
| `admin.deliveryTicket.list` | GET | `/admin/delivery-tickets` | 交付工单列表：状态页签、关键字、交付经理（含未分配）、制作模型、平台、仅看超时；默认按紧急程度排序；也用于各队列视图 | — | none | V1.0 | 3.16 |
| `admin.deliveryTicket.summary` | GET | `/admin/delivery-tickets/summary` | 工单池页头统计与状态页签计数（处理中、超时或逾期、今日截止） | — | none | V1.0 | 3.17 |
| `admin.deliveryTicket.get` | GET | `/admin/delivery-tickets/{deliveryTicketId}` | 工单详情聚合：11 步进度、方案、广告、样片与质检、成片与发布、侧栏商家 / 订购单 / 负责人 / 时效 | — | none | V1.0 | 3.18 |
| `admin.deliveryTicket.activity.list` | GET | `/admin/delivery-tickets/{deliveryTicketId}/activities` | 工单操作日志（系统、员工、商家） | — | none | V1.0 | 3.19 |
| `admin.deliveryTicket.assignEditor` | POST | `/admin/delivery-tickets/{deliveryTicketId}/assign-editor` | 指派或改派剪辑师 | `delivery.ticket.assign_editor` | required | V1.0 | 3.21 |
| `admin.deliveryTicket.assignManager` | POST | `/admin/delivery-tickets/{deliveryTicketId}/assign-manager` | 分配交付经理（单选，显示在办量与轮询推荐，说明 ≤100 字）；进入方案确认并通知 | `merchant.manager.assign` | required | V1.0 | 3.20 |
| `admin.deliveryTicket.assignPublisher` | POST | `/admin/delivery-tickets/{deliveryTicketId}/assign-publisher` | 改派发布专员（开工时已轮询指派） | `delivery.ticket.assign_publisher` | required | V1.0 | 3.22 |
| `admin.deliveryTicket.episodeOutput.list` | GET | `/admin/delivery-tickets/{deliveryTicketId}/episode-outputs` | 成片剧集列表：逐集文件、大小、质检状态（成片包格子） | — | none | V1.0 | 3.29 |
| `admin.deliveryTicket.episodeOutput.create` | POST | `/admin/delivery-tickets/{deliveryTicketId}/episode-outputs` | 登记成片剧集（批量；同一集再登记即换版；可带补发单 id） | `delivery.episode.register` | required | V1.0 | 3.30 |
| `admin.deliveryTicket.forceTransition` | POST | `/admin/delivery-tickets/{deliveryTicketId}/force-transition` | 人工纠偏：把工单改到更正白名单内的指定步骤（写 is_forced 状态历史；原因不少于 10 字） | `flow.admin.transition` | required | V1.0 | 3.26 |
| `admin.deliveryTicket.inspectEpisodes` | POST | `/admin/delivery-tickets/{deliveryTicketId}/inspect-episodes` | 逐集质检（批量）：通过或不通过并注明原因；全部通过后系统推进到成片交付 | `delivery.episode.qc` | required | V1.0 | 3.31 |
| `admin.deliveryTicket.inspectPackage` | POST | `/admin/delivery-tickets/{deliveryTicketId}/inspect-package` | 成片包级质检（集数完整等成片阶段清单项） | `delivery.episode.qc` | required | V1.0 | 3.32 |
| `admin.deliveryTicket.material.list` | GET | `/admin/delivery-tickets/{deliveryTicketId}/materials` | 制作素材清单（原片、门店素材、广告）：只列素材与上次取料记录，不签发地址 | — | none | V1.0 | 3.27 |
| `admin.deliveryTicket.material.downloadUrls` | POST | `/admin/delivery-tickets/{deliveryTicketId}/materials/download-urls` | 签发制作素材（原片、门店素材、广告）的短时下载地址，逐次留取料记录 | `delivery.download` | none | V1.0 | 3.28 |
| `admin.deliveryTicket.pushPackage` | POST | `/admin/delivery-tickets/{deliveryTicketId}/push-package` | 推送成片包与发布清单（交付前检查全过）：生成成片包与下载授权、为每个发布账号建上线任务、通知商家 | `publish.package.push` | required | V1.0 | 3.33 |
| `admin.deliveryTicket.reevaluate` | POST | `/admin/delivery-tickets/{deliveryTicketId}/reevaluate` | 对卡住的工单重新求值（满足条件即推进步骤） | `flow.ops.manage` | required | V1.0 | 3.25 |
| `admin.deliveryTicket.reissue.create` | POST | `/admin/delivery-tickets/{deliveryTicketId}/reissues` | 发起补发（交付后发现成片有误；原因与说明必填） | `delivery.package.reissue` | required | V1.0 | 3.43 |
| `admin.deliveryTicket.remind` | POST | `/admin/delivery-tickets/{deliveryTicketId}/remind` | 人工催办商家：确认方案、确认样片、上线提醒（订阅消息与短信补发；同一对象同一场景每日一次） | `assert-in-handler` | required | V1.0 | 3.23 |
| `admin.deliveryTicket.rework` | POST | `/admin/delivery-tickets/{deliveryTicketId}/rework` | 主管返工：从批量合成或成片交付退回样片制作（广告就绪）或广告准备，必填原因 | `delivery.ticket.rework` | required | V1.0 | 3.24 |
| `admin.deliveryTicket.sample.create` | POST | `/admin/delivery-tickets/{deliveryTicketId}/samples` | 登记样片新版本（文件已上传；未决旧版本置 superseded） | `delivery.sample.upload` | required | V1.0 | 3.38 |
| `admin.licenseLetterRevision.rerender` | POST | `/admin/license-letter-revisions/{licenseLetterRevisionId}/rerender` | 授权书版次渲染失败后重新生成 | `order.license_letter.manage` | required | V1.0 | 3.50 |
| `admin.licenseLetter.correct` | POST | `/admin/license-letters/{licenseLetterId}/correct` | 授权书更正并重出（主体更名、账号名笔误；编号不变，出 correction 版次） | `order.license_letter.manage` | required | V1.0 | 3.48 |
| `admin.licenseLetter.void` | POST | `/admin/license-letters/{licenseLetterId}/void` | 人工作废授权书并按当前事实重出新信（原因必填） | `order.license_letter.manage` | required | V1.0 | 3.49 |
| `admin.orderItem.download.list` | GET | `/admin/order-items/{orderItemId}/downloads` | 成片包、下载授权与下载记录（排障与证据） | — | none | V1.0 | 3.46 |
| `admin.orderItem.licenseLetter.list` | GET | `/admin/order-items/{orderItemId}/license-letters` | 订单项的定制内容授权书（每个发布账号一份）与当前版次文件 | — | none | V1.0 | 3.47 |
| `admin.orderItem.rescheduleLaunch` | POST | `/admin/order-items/{orderItemId}/reschedule-launch` | 改约定上线日（首个账号核验通过前可改；写审计） | `delivery.plan.reschedule` | required | V1.0 | 3.37 |
| `admin.order.list` | GET | `/admin/orders` | 订购单列表：订单号 / 商家 / 剧名、下单时间、交付经理、剧目、状态（8 种）；每页 10 | — | none | V1.0 | 3.1 |
| `admin.order.quote` | POST | `/admin/orders/quote` | 订购积分试算：剧目、套餐版本、是否顶级模型 → P、R、T、S 与算式（与商家端确认订购同一实现） | — | none | V1.0 | 3.3 |
| `admin.order.summary` | GET | `/admin/orders/summary` | 订购单状态筛选条计数 | — | none | V1.0 | 3.2 |
| `admin.order.get` | GET | `/admin/orders/{orderId}` | 订购单详情：进度、剧目明细与工单、定制需求、协议与授权书、积分明细与冻结扣减时间线、商家与负责人 | — | none | V1.0 | 3.4 |
| `admin.order.activity.list` | GET | `/admin/orders/{orderId}/activities` | 订购单操作日志 | — | none | V1.0 | 3.5 |
| `admin.order.cancelQuote` | POST | `/admin/orders/{orderId}/cancel-quote` | 取消预览：按剧逐行核算（阶段、已扣、扣除比例、退回）与账本去向；切换原因即重算 | `order.refund.request` | none | V1.0 | 3.6 |
| `admin.order.cancelRequest.create` | POST | `/admin/orders/{orderId}/cancel-requests` | 发起订购取消（原因、说明 ≥5 字）：同事务建取消申请与审批单，订单进入售后处理中、工单暂停 | `order.refund.request` | required | V1.0 | 3.7 |
| `admin.productionRecord.list` | GET | `/admin/production-records` | 制作文件事实查询（体检结论、AI 声明、隐式标识回读） | — | none | V1.0 | 3.63 |
| `admin.productionRecord.normalize` | POST | `/admin/production-records/{productionRecordId}/normalize` | 云端规格化（人工触发，产出新文件） | `production.normalize` | required | V1.0 | 3.64 |
| `admin.productionRecord.recheck` | POST | `/admin/production-records/{productionRecordId}/recheck` | 规则版本升级后人工触发重检 | `production.recheck` | required | V1.0 | 3.66 |
| `admin.productionRecord.restamp` | POST | `/admin/production-records/{productionRecordId}/restamp` | 补标：更正 AI 声明后写入隐式标识（产生新文件） | `production.restamp` | required | V1.0 | 3.65 |
| `admin.reissue.cancel` | POST | `/admin/reissues/{reissueId}/cancel` | 取消补发 | `delivery.package.reissue` | required | V1.0 | 3.44 |
| `admin.reissue.publish` | POST | `/admin/reissues/{reissueId}/publish` | 发布补发：替换行生效，旧成片包被新包取代并重发下载授权 | `publish.package.push` | required | V1.0 | 3.45 |
| `admin.sample.inspect` | POST | `/admin/samples/{sampleId}/inspect` | 样片质检：逐项清单结果，通过或不通过（注明原因） | `delivery.sample.qc` | required | V1.0 | 3.39 |
| `admin.sample.markSent` | POST | `/admin/samples/{sampleId}/mark-sent` | 登记已经企业微信向老板发送样片水印版（写 offline_sent_at 与发送人） | `delivery.sample.push` | required | V1.0 | 3.40 |
| `admin.sample.push` | POST | `/admin/samples/{sampleId}/push` | 推送样片给商家确认（previewChannels：小程序不播放时提供水印版存相册、电脑端或企业微信） | `delivery.sample.push` | required | V1.0 | 3.41 |
| `admin.sample.requestChange` | POST | `/admin/samples/{sampleId}/request-change` | 交付经理代录修改意见：合成问题（不计次，退回样片制作）或广告内容（计入广告修改次数，退回广告准备） | `delivery.sample.feedback_on_behalf` | required | V1.0 | 3.42 |

### [后台：发布与巡检](a06-publish.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.channelAccountSubmission.get` | GET | `/admin/channel-account-submissions/{channelAccountSubmissionId}` | 账号核验详情：填报信息与截图比对表、历次核验记录、审批单引用 | — | none | V1.0 | 3.5 |
| `admin.channelAccountSubmission.approve` | POST | `/admin/channel-account-submissions/{channelAccountSubmissionId}/approve` | 账号核验通过（比对表没有不一致项；填写账号类型） | `publish.account.verify` | required | V1.0 | 3.6 |
| `admin.channelAccountSubmission.reject` | POST | `/admin/channel-account-submissions/{channelAccountSubmissionId}/reject` | 账号核验驳回（原画板“标记异常”）：原因（字典）与说明必填 | `publish.account.verify` | required | V1.0 | 3.7 |
| `admin.channelAccount.list` | GET | `/admin/channel-accounts` | 渠道账号列表（商家详情“渠道账号”页签）：平台、账号名、账号 ID、状态、类型、认证主体、核验记录、使用中的剧目 | — | none | V1.0 | 3.1 |
| `admin.channelAccount.summary` | GET | `/admin/channel-accounts/summary` | 渠道账号计数（商家详情“渠道账号”页签角标，按状态） | — | none | V1.0 | 3.2 |
| `admin.channelAccount.get` | GET | `/admin/channel-accounts/{channelAccountId}` | 渠道账号详情与历次核验提交 | — | none | V1.0 | 3.3 |
| `admin.channelAccount.markAbnormal` | POST | `/admin/channel-accounts/{channelAccountId}/mark-abnormal` | 把可用账号人工标记为异常（原因与说明必填）；新订购与新方案不可选，不影响在办订单 | `publish.account.mark_abnormal` | required | V1.0 | 3.4 |
| `admin.deliveryRelease.get` | GET | `/admin/delivery-releases/{deliveryReleaseId}` | 成片包详情（清单、大小、ZIP 缓存状态） | — | none | V1.0 | 3.11 |
| `admin.deliveryRelease.pack` | POST | `/admin/delivery-releases/{deliveryReleaseId}/pack` | 预打包 ZIP（供电脑端下载页整包下载） | `publish.package.push` | required | V1.0 | 3.12 |
| `admin.deliveryTicket.publishList.get` | GET | `/admin/delivery-tickets/{deliveryTicketId}/publish-list` | 发布清单：合集名称、封面、每集标题模板与逐集标题、话题、简介；交付前检查项 | — | none | V1.0 | 3.8 |
| `admin.deliveryTicket.publishList.replace` | PUT | `/admin/delivery-tickets/{deliveryTicketId}/publish-list` | 保存发布清单（带 lockVersion） | `publish.list.edit` | required | V1.0 | 3.9 |
| `admin.deliveryTicket.publishList.import` | POST | `/admin/delivery-tickets/{deliveryTicketId}/publish-list/import` | 表格导入逐集标题与看点（行级校验） | `publish.list.edit` | required | V1.0 | 3.10 |
| `admin.launchCalendar.get` | GET | `/admin/launch-calendar` | 上线日历：按约定上线日聚合交付中的工单（制作中、待上线、上线核验、已逾期），可按交付经理筛选；当日与逾期面板 | — | none | V1.0 | 3.13 |
| `admin.launchSubmission.get` | GET | `/admin/launch-submissions/{launchSubmissionId}` | 链接核验详情：回填链接与截图、核验清单、本轮与历次核验记录、审批单引用 | — | none | V1.0 | 3.16 |
| `admin.launchSubmission.approve` | POST | `/admin/launch-submissions/{launchSubmissionId}/approve` | 链接核验通过（清单 launch.verify 全部通过；首个账号通过时写使用期起始日） | `publish.link.verify` | required | V1.0 | 3.17 |
| `admin.launchSubmission.reject` | POST | `/admin/launch-submissions/{launchSubmissionId}/reject` | 链接核验退回修改：原因（字典 reject_reason，场景 link_verify）至少 1 项 + 说明 | `publish.link.verify` | required | V1.0 | 3.18 |
| `admin.launchSubmission.revoke` | POST | `/admin/launch-submissions/{launchSubmissionId}/revoke` | 撤销核验通过（1 个工作日内；无已确认或已核查的下架任务）：重开新一轮核验 | `publish.link.verify_revoke` | required | V1.0 | 3.19 |
| `admin.launchTask.list` | GET | `/admin/launch-tasks` | 上线任务查询：逾期未上线（任务粒度，带跟进时间线）、7 日内待上线（可仅看成片已交付） | — | none | V1.0 | 3.14 |
| `admin.launchTask.summary` | GET | `/admin/launch-tasks/summary` | 逾期跟踪指标卡：逾期未上线、7 日内待上线、7 日内成片交付中、近 30 天逾期（平均逾期天数、已上线数） | — | none | V1.0 | 3.15 |
| `admin.metricImport.create` | POST | `/admin/metric-imports` | 上传 Excel 并逐行校验（返回逐行结果与导入批次） | `publish.metrics.enter` | required | V1.1 | 3.36 |
| `admin.metricImport.template.get` | GET | `/admin/metric-imports/template` | 下载数据录入模板 | — | none | V1.1 | 3.37 |
| `admin.metricImport.commit` | POST | `/admin/metric-imports/{metricImportId}/commit` | 提交导入：只导入校验通过的行（按批次防重复） | `publish.metrics.enter` | required | V1.1 | 3.38 |
| `admin.metricSubmission.list` | GET | `/admin/metric-submissions` | 作品数据提交队列（待录入、已录入、已驳回） | — | none | V1.1 | 3.39 |
| `admin.metricSubmission.approve` | POST | `/admin/metric-submissions/{metricSubmissionId}/approve` | 录入 7 项指标并通过（播放量降幅超 30% 时生成巡检任务） | `publish.metrics.enter` | required | V1.1 | 3.40 |
| `admin.metricSubmission.reject` | POST | `/admin/metric-submissions/{metricSubmissionId}/reject` | 驳回数据提交（原因 + 说明） | `publish.metrics.enter` | required | V1.1 | 3.41 |
| `admin.patrolTask.list` | GET | `/admin/patrol-tasks` | 作品巡检列表：本周批次、页签（全部、待巡检、异常、正常），异常排前 | — | none | V1.0 | 3.20 |
| `admin.patrolTask.create` | POST | `/admin/patrol-tasks` | 手动发起巡检（同一上线任务已有在办巡检时返回那一条） | `publish.patrol.do` | required | V1.0 | 3.23 |
| `admin.patrolTask.summary` | GET | `/admin/patrol-tasks/summary` | 本周巡检页头：上线中部数、抽查数、已巡检、异常 | — | none | V1.0 | 3.21 |
| `admin.patrolTask.get` | GET | `/admin/patrol-tasks/{patrolTaskId}` | 巡检任务详情：账号、使用期、异常信息、巡检项 | — | none | V1.0 | 3.22 |
| `admin.patrolTask.markAbnormal` | POST | `/admin/patrol-tasks/{patrolTaskId}/mark-abnormal` | 发现异常：异常类型与说明、截图；通知商家，3 天后仍异常转交付经理待办 | `publish.patrol.do` | required | V1.0 | 3.25 |
| `admin.patrolTask.markNormal` | POST | `/admin/patrol-tasks/{patrolTaskId}/mark-normal` | 巡检正常（清单全过，截图至少 1 张） | `publish.patrol.do` | required | V1.0 | 3.24 |
| `admin.patrolTask.recover` | POST | `/admin/patrol-tasks/{patrolTaskId}/recover` | 复查已恢复（清单全过，追加复查截图） | `publish.patrol.do` | required | V1.0 | 3.26 |
| `admin.patrolTask.remind` | POST | `/admin/patrol-tasks/{patrolTaskId}/remind` | 再次提醒商家处理异常（限频） | `publish.patrol.do` | required | V1.0 | 3.27 |
| `admin.takedownTask.list` | GET | `/admin/takedown-tasks` | 下架核查队列：待核查、已核查（逾期、今日截止标记） | — | none | V1.0 | 3.28 |
| `admin.takedownTask.batchCheck` | POST | `/admin/takedown-tasks/check` | 批量核查下架（每个任务各带证据截图） | `publish.takedown.check` | required | V1.0 | 3.29 |
| `admin.takedownTask.summary` | GET | `/admin/takedown-tasks/summary` | 下架核查页签计数：待核查、已核查（含逾期、今日截止） | — | none | V1.0 | 3.30 |
| `admin.takedownTask.get` | GET | `/admin/takedown-tasks/{takedownTaskId}` | 下架任务详情：使用期、结束依据、下架方式与商家确认、处理记录、证据截图 | — | none | V1.0 | 3.31 |
| `admin.takedownTask.check` | POST | `/admin/takedown-tasks/{takedownTaskId}/check` | 核查通过（清单全过，证据截图 ≥2 张，长期留存）；全部账号核查后工单归档 | `publish.takedown.check` | required | V1.0 | 3.32 |
| `admin.takedownTask.escalate` | POST | `/admin/takedown-tasks/{takedownTaskId}/escalate` | 逾期未下架手动升级（通知交付主管与交付经理） | `publish.takedown.check` | required | V1.0 | 3.33 |
| `admin.takedownTask.markOnline` | POST | `/admin/takedown-tasks/{takedownTaskId}/mark-online` | 抽查仍在线：记录结果、通知商家、升级交付主管 | `publish.takedown.check` | required | V1.0 | 3.34 |
| `admin.takedownTask.sendBreachNotice` | POST | `/admin/takedown-tasks/{takedownTaskId}/send-breach-notice` | 发送违约提醒：要求 24 小时内删除作品或设为仅自己可见（限频） | `publish.takedown.breach_notice` | required | V1.0 | 3.35 |

### [后台：套餐积分与财务](a07-billing-finance.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.billingParam.list` | GET | `/admin/billing-params` | 积分规则参数：取消扣除比例三档、广告每条积分、免费修改次数、顶级模型加扣、最短可订授权期、可选购买周期、提醒节点；当前值、待生效值与默认值 | — | none | V1.0 | 3.16 |
| `admin.billingParam.withdraw` | POST | `/admin/billing-params/{billingParamId}/withdraw` | 撤销一条待生效参数（整组撤销时撤回公告） | `billing.param.edit` | required | V1.0 | 3.19 |
| `admin.financeConfigRevision.list` | GET | `/admin/finance-config-revisions` | 受控财务配置：当前生效值（tab=current；对公收款账户账号脱敏、购买入口策略、内控开关组）与版本列表（含待审提议） | — | none | V1.0 | 3.80 |
| `admin.financeConfigRevision.create` | POST | `/admin/finance-config-revisions` | 提议变更受控配置（同事务建审批单；同一个键同时只允许一张待审） | `finance.config.propose` | required | V1.0 | 3.81 |
| `admin.financeConfigRevision.approve` | POST | `/admin/finance-config-revisions/{financeConfigRevisionId}/approve` | 批准受控财务配置变更（收款账户批准 24 小时后生效） | `finance.config.approve` | required | V1.0 | 3.82 |
| `admin.financeConfigRevision.reject` | POST | `/admin/finance-config-revisions/{financeConfigRevisionId}/reject` | 驳回受控财务配置变更（说明必填） | `finance.config.approve` | required | V1.0 | 3.83 |
| `admin.financeConfigRevision.withdraw` | POST | `/admin/finance-config-revisions/{financeConfigRevisionId}/withdraw` | 撤回待审的受控财务配置提议（提议人本人；发起人已停用时代撤） | `assert-in-handler` | required | V1.0 | 3.84 |
| `admin.invoiceRequest.list` | GET | `/admin/invoice-requests` | 开票申请队列：待开票、待红冲、已处理（已开具、已寄出、已驳回、已红冲） | — | none | V1.0 | 3.67 |
| `admin.invoiceRequest.summary` | GET | `/admin/invoice-requests/summary` | 发票页 KPI：待开票金额与张数、本月已开票 | — | none | V1.0 | 3.68 |
| `admin.invoiceRequest.get` | GET | `/admin/invoice-requests/{invoiceRequestId}` | 开票申请详情：付款单、抬头与税号（脱敏）、专票信息、接收方式、开票前自动核对项 | — | none | V1.0 | 3.69 |
| `admin.invoiceRequest.issue` | POST | `/admin/invoice-requests/{invoiceRequestId}/issue` | 开具：电子（发票号码 20 位 + PDF / OFD 文件，推送商家并发邮件）或纸质（号码 + 快递公司 + 运单号） | `finance.invoice.issue` | required | V1.0 | 3.70 |
| `admin.invoiceRequest.issueRed` | POST | `/admin/invoice-requests/{invoiceRequestId}/issue-red` | 回填红字发票（号码 + 文件），之后才能执行该付款单的退款 | `finance.invoice.red` | required | V1.0 | 3.72 |
| `admin.invoiceRequest.reject` | POST | `/admin/invoice-requests/{invoiceRequestId}/reject` | 驳回开票申请（原因 + 说明；商家可补正后重新申请） | `finance.invoice.issue` | required | V1.0 | 3.71 |
| `admin.invoiceRequest.resend` | POST | `/admin/invoice-requests/{invoiceRequestId}/resend` | 重发电子发票邮件 | `finance.invoice.issue` | required | V1.0 | 3.73 |
| `admin.paymentException.list` | GET | `/admin/payment-exceptions` | 差异单列表（按日期、状态、类型） | — | none | V1.0 | 3.76 |
| `admin.paymentException.create` | POST | `/admin/payment-exceptions` | 登记异常到账（建孤儿收款与 bank_unmatched 差异单） | `finance.recon.resolve` | required | V1.0 | 3.78 |
| `admin.paymentException.get` | GET | `/admin/payment-exceptions/{paymentExceptionId}` | 差异单详情：账单侧事实、平台侧事实、差异原因、可选处理方式 | — | none | V1.0 | 3.77 |
| `admin.paymentException.resolve` | POST | `/admin/payment-exceptions/{paymentExceptionId}/resolve` | 处理差异：补单、转退款（生成退款申请走审批）、重试履约、重建付款单、关联付款单并确认、线下退回、补记渠道退款、数据更正、核销（说明必填） | `finance.recon.resolve` | required | V1.0 | 3.79 |
| `admin.paymentOrder.list` | GET | `/admin/payment-orders` | 付款单列表：单号 / 商家 / 主体、时间、类型、支付方式、状态（5 种） | — | none | V1.0 | 3.40 |
| `admin.paymentOrder.create` | POST | `/admin/payment-orders` | 线下开单（对公转账；须合同号，受控开关 controls.admin_create_order 开启） | `order.payment.create_offline` | required | V1.0 | 3.43 |
| `admin.paymentOrder.summary` | GET | `/admin/payment-orders/summary` | 付款单状态筛选条计数 | — | none | V1.0 | 3.41 |
| `admin.paymentOrder.get` | GET | `/admin/payment-orders/{paymentOrderId}` | 付款单详情（右侧抽屉）：应付 / 实付、生效说明、计算式、支付记录、发票状态、操作日志 | — | none | V1.0 | 3.42 |
| `admin.paymentOrder.refundQuote` | POST | `/admin/payment-orders/{paymentOrderId}/refund-quote` | 现金退款试算（套餐 7 天窗口、资质终审不通过、规则外） | `order.refund.request` | none | V1.0 | 3.54 |
| `admin.paymentOrder.refundRequest.create` | POST | `/admin/payment-orders/{paymentOrderId}/refund-requests` | 发起现金退款申请（服务端核算数额；同事务建审批单、暂停该周期与开票） | `order.refund.request` | required | V1.0 | 3.55 |
| `admin.paymentOrder.transferProof.create` | POST | `/admin/payment-orders/{paymentOrderId}/transfer-proofs` | 后台代传对公转账凭证（触发识别与比对） | `finance.receipt.confirm` | required | V1.0 | 3.44 |
| `admin.paymentTransaction.list` | GET | `/admin/payment-transactions` | 收款流水：付款单号 / 交易单号 / 商家搜索，时间、类型、方式、对账状态（合计由 summary 按同一筛选给出） | — | none | V1.0 | 3.52 |
| `admin.paymentTransaction.summary` | GET | `/admin/payment-transactions/summary` | 收款流水 KPI：今日收款、本月收款、本月退款、对账差异 | — | none | V1.0 | 3.53 |
| `admin.planRevision.list` | GET | `/admin/plan-revisions` | 套餐调整与公告记录（待生效、已生效、已撤销） | — | none | V1.0 | 3.7 |
| `admin.planRevision.withdraw` | POST | `/admin/plan-revisions/{planRevisionId}/withdraw` | 生效前撤销价目修订，同事务撤回公告 | `billing.plan.edit` | required | V1.0 | 3.8 |
| `admin.plan.list` | GET | `/admin/plans` | 套餐版本与权益矩阵（当前价目、待生效价目、上下架状态） | — | none | V1.0 | 3.1 |
| `admin.plan.create` | POST | `/admin/plans` | 新建套餐版本（先建价目修订再上架） | `billing.plan.edit` | required | V1.0 | 3.3 |
| `admin.plan.quote` | POST | `/admin/plans/quote` | 升级补差或续费试算（请求体区分升级与续费；与商家端选择套餐同一实现）：版本、周期 → 算式、新周期、每月积分、应付金额 | `assert-in-handler` | none | V1.0 | 3.9 |
| `admin.plan.summary` | GET | `/admin/plans/summary` | 套餐页 KPI：套餐生效家数、月度经常性收入、本月新开通、本月续费 | — | none | V1.0 | 3.2 |
| `admin.plan.update` | PATCH | `/admin/plans/{planId}` | 改套餐版本名称（只改 plan.name；code、rank 创建后不改，价格与权益走价目修订） | `billing.plan.edit` | required | V1.0 | 3.85 |
| `admin.plan.delist` | POST | `/admin/plans/{planId}/delist` | 套餐下架（不可新购与续费，已有周期不受影响） | `billing.plan.edit` | required | V1.0 | 3.5 |
| `admin.plan.planRevision.create` | POST | `/admin/plans/{planId}/plan-revisions` | 编辑版本：月费、积分、折扣、门店与成员上限、制作模型、生效日期（≥今天 + 30 天）、首期优惠；同事务建规则变更公告 | `billing.plan.edit` | required | V1.0 | 3.6 |
| `admin.plan.shelve` | POST | `/admin/plans/{planId}/shelve` | 套餐上架（可新购与续费） | `billing.plan.edit` | required | V1.0 | 3.4 |
| `admin.pointAccount.list` | GET | `/admin/point-accounts` | 积分账户列表（主体）：套餐、套餐积分与清零时间、加购积分、可用与冻结；筛选套餐与账户状态 | — | none | V1.0 | 3.20 |
| `admin.pointAccount.summary` | GET | `/admin/point-accounts/summary` | 积分账户页 KPI：积分余额（含冻结）、本月发放、本月消耗 | — | none | V1.0 | 3.21 |
| `admin.pointAccount.get` | GET | `/admin/point-accounts/{pointAccountId}` | 积分账户详情：套餐、本期、可用 / 套餐 / 加购 / 冻结、在办退款与待审调整提示 | — | none | V1.0 | 3.22 |
| `admin.pointAccount.adjustmentQuote` | POST | `/admin/point-accounts/{pointAccountId}/adjustment-quote` | 积分调整影响预览：方向、类型、数量 → 可用 a → b | `billing.adjust.request` | none | V1.0 | 3.24 |
| `admin.pointAccount.pointLedgerEntry.list` | GET | `/admin/point-accounts/{pointAccountId}/point-ledger-entries` | 积分流水：分组（获得、使用、清零），时间倒序游标分页，每行带变动后可用余额 | — | none | V1.0 | 3.23 |
| `admin.pointAdjustmentRequest.create` | POST | `/admin/point-adjustment-requests` | 发起积分调整（方向、积分类型、数量、原因、说明 5–200 字；可关联订购、广告）：同事务建审批单，提交不动账 | `billing.adjust.request` | required | V1.0 | 3.25 |
| `admin.pointAdjustmentRequest.get` | GET | `/admin/point-adjustment-requests/{pointAdjustmentRequestId}` | 积分调整单详情：方向、积分类型、数量、原因与说明、关联订购或广告、调整前后可用积分、入账结果与审批记录 | `assert-in-handler` | none | V1.0 | 3.26 |
| `admin.pointAdjustmentRequest.approve` | POST | `/admin/point-adjustment-requests/{pointAdjustmentRequestId}/approve` | 通过积分调整（同一事务入账） | `billing.adjust.approve` | required | V1.0 | 3.27 |
| `admin.pointAdjustmentRequest.reject` | POST | `/admin/point-adjustment-requests/{pointAdjustmentRequestId}/reject` | 驳回积分调整（原因可选，说明必填） | `billing.adjust.approve` | required | V1.0 | 3.28 |
| `admin.pointAdjustmentRequest.withdraw` | POST | `/admin/point-adjustment-requests/{pointAdjustmentRequestId}/withdraw` | 撤回待审的积分调整（提交人本人；发起人已停用时代撤） | `assert-in-handler` | required | V1.0 | 3.29 |
| `admin.pointPack.list` | GET | `/admin/point-packs` | 积分包列表（积分、价格、单价、本月售出、状态） | — | none | V1.0 | 3.10 |
| `admin.pointPack.create` | POST | `/admin/point-packs` | 新增积分包（新增即上架；积分 ≥100、上架中不重复） | `billing.pack.edit` | required | V1.0 | 3.12 |
| `admin.pointPack.summary` | GET | `/admin/point-packs/summary` | 积分包页 KPI 与近 6 个月加购积分柱状图数据 | — | none | V1.0 | 3.11 |
| `admin.pointPack.update` | PATCH | `/admin/point-packs/{pointPackId}` | 编辑积分包（之后的购买生效；未支付付款单按原价） | `billing.pack.edit` | required | V1.0 | 3.13 |
| `admin.pointPack.delist` | POST | `/admin/point-packs/{pointPackId}/delist` | 下架积分包 | `billing.pack.edit` | required | V1.0 | 3.15 |
| `admin.pointPack.shelve` | POST | `/admin/point-packs/{pointPackId}/shelve` | 上架积分包 | `billing.pack.edit` | required | V1.0 | 3.14 |
| `admin.pricingChange.list` | GET | `/admin/pricing-changes` | “积分价模板与参数”变更记录：合并返回等级模板价与计费参数两类历史（按变更集聚合） | — | none | V1.0 | 3.17 |
| `admin.pricingChange.create` | POST | `/admin/pricing-changes` | 保存“积分价模板与参数”变更集：等级模板价（4 档，S ≥ A ≥ B ≥ C）与计费参数 [{key, value, effectiveAt}] 在同一事务写两类修订；按模板定价的剧同步变价；计费规则类同事务建公告 | `assert-in-handler` | required | V1.0 | 3.18 |
| `admin.reconciliation.list` | GET | `/admin/reconciliations` | 按月查看对账：月度概览、每日对账行（平台收款、微信账单、对公、退款、差异、状态）、账单下载进度 | — | none | V1.0 | 3.74 |
| `admin.reconciliation.rerun` | POST | `/admin/reconciliations/{reconciliationId}/rerun` | 重新对账（重跑某日匹配步骤） | `finance.recon.resolve` | required | V1.0 | 3.75 |
| `admin.refundRequest.list` | GET | `/admin/refund-requests` | 现金退款申请列表：页签（待审批、待执行（含执行中）、已处理、全部）、单号、商家 | — | none | V1.0 | 3.56 |
| `admin.refundRequest.summary` | GET | `/admin/refund-requests/summary` | 现金退款页签计数与指标：本月已退款金额与笔数、审批与执行中、本月驳回 | — | none | V1.0 | 3.57 |
| `admin.refundRequest.get` | GET | `/admin/refund-requests/{refundRequestId}` | 现金退款申请详情：核算依据、执行结果与退款交易（失败原因、可否重试、可否确认未受理）、审批记录 | `assert-in-handler` | none | V1.0 | 3.58 |
| `admin.refundRequest.approve` | POST | `/admin/refund-requests/{refundRequestId}/approve` | 通过现金退款申请，进入待执行 | `finance.refund.approve` | required | V1.0 | 3.59 |
| `admin.refundRequest.confirmNotAccepted` | POST | `/admin/refund-requests/{refundRequestId}/confirm-not-accepted` | 确认微信未受理（停止重试 ≥10 分钟且查询无此退款单），申请回到待执行 | `finance.refund.execute` | required | V1.0 | 3.65 |
| `admin.refundRequest.execute` | POST | `/admin/refund-requests/{refundRequestId}/execute` | 执行退款（微信原路）：勾选核对原交易单号与金额；先回收权益再提交微信退款，结果由回调或查单落终态 | `finance.refund.execute` | required | V1.0 | 3.62 |
| `admin.refundRequest.recordOffline` | POST | `/admin/refund-requests/{refundRequestId}/record-offline` | 线下退款登记（对公付款的退款）：转账日期、银行流水号、回单文件 | `finance.refund.execute` | required | V1.0 | 3.63 |
| `admin.refundRequest.reject` | POST | `/admin/refund-requests/{refundRequestId}/reject` | 驳回现金退款申请（说明必填），恢复周期与开票 | `finance.refund.approve` | required | V1.0 | 3.60 |
| `admin.refundRequest.retry` | POST | `/admin/refund-requests/{refundRequestId}/retry` | 以同一商户退款单号重试微信退款 | `finance.refund.execute` | required | V1.0 | 3.64 |
| `admin.refundRequest.void` | POST | `/admin/refund-requests/{refundRequestId}/void` | 作废已审批未执行的退款申请（说明必填），恢复周期与开票 | `finance.refund.approve` | required | V1.0 | 3.66 |
| `admin.refundRequest.withdraw` | POST | `/admin/refund-requests/{refundRequestId}/withdraw` | 撤回尚未审批的现金退款申请（仅申请人；发起人已停用时代撤） | `assert-in-handler` | required | V1.0 | 3.61 |
| `admin.subscriptionTerm.list` | GET | `/admin/subscription-terms` | 套餐到期跟进：7 天内到期、已过期未续费（30 天内）、本月已续费；搜索、交付经理、版本筛选 | — | none | V1.0 | 3.30 |
| `admin.subscriptionTerm.summary` | GET | `/admin/subscription-terms/summary` | 套餐到期页 KPI：7 天内到期、已过期未续费、本月续费率 | — | none | V1.0 | 3.31 |
| `admin.subscriptionTerm.get` | GET | `/admin/subscription-terms/{subscriptionTermId}` | 到期详情：本期、积分清零与冻结预告、在播短剧、续费信息、提醒时间线、跟进记录 | — | none | V1.0 | 3.32 |
| `admin.subscriptionTerm.extensionQuote` | POST | `/admin/subscription-terms/{subscriptionTermId}/extension-quote` | 补偿延长影响预览：延长后周期、清零时间顺延、已排队周期后移 | `billing.extension.request` | none | V1.0 | 3.33 |
| `admin.subscriptionTerm.remind` | POST | `/admin/subscription-terms/{subscriptionTermId}/remind` | 补发续费提醒（订阅消息 + 短信；按“主体 + 日期”每天一次） | `order.renewal.remind` | required | V1.0 | 3.34 |
| `admin.termExtensionRequest.create` | POST | `/admin/term-extension-requests` | 发起补偿延长（3 / 7 / 15 / 30 天、原因、说明）：同事务建审批单，主管审批通过即顺延 | `billing.extension.request` | required | V1.0 | 3.35 |
| `admin.termExtensionRequest.get` | GET | `/admin/term-extension-requests/{termExtensionRequestId}` | 补偿延长单详情：延长天数、原因与说明、延长前后的周期、清零时间的顺延、执行结果与审批记录 | `assert-in-handler` | none | V1.0 | 3.36 |
| `admin.termExtensionRequest.approve` | POST | `/admin/term-extension-requests/{termExtensionRequestId}/approve` | 通过补偿延长（同一事务顺延有效期；已到期未续费则复活周期） | `billing.extension.approve` | required | V1.0 | 3.37 |
| `admin.termExtensionRequest.reject` | POST | `/admin/term-extension-requests/{termExtensionRequestId}/reject` | 驳回补偿延长（说明必填） | `billing.extension.approve` | required | V1.0 | 3.38 |
| `admin.termExtensionRequest.withdraw` | POST | `/admin/term-extension-requests/{termExtensionRequestId}/withdraw` | 撤回待审的补偿延长（提交人本人；发起人已停用时代撤） | `assert-in-handler` | required | V1.0 | 3.39 |
| `admin.transferProof.list` | GET | `/admin/transfer-proofs` | 对公收款确认队列：待确认、今日已处理；提示标签（昨日上传、附言缺付款单号） | — | none | V1.0 | 3.45 |
| `admin.transferProof.summary` | GET | `/admin/transfer-proofs/summary` | 对公收款确认页签计数：待确认、今日已处理 | — | none | V1.0 | 3.46 |
| `admin.transferProof.get` | GET | `/admin/transfer-proofs/{transferProofId}` | 凭证详情：付款单信息、业务提示、凭证图、识别字段与系统比对（户名、金额、附言、时间） | `assert-in-handler` | none | V1.0 | 3.47 |
| `admin.transferProof.approveReview` | POST | `/admin/transfer-proofs/{transferProofId}/approve-review` | 对公大额二人复核通过：凭证置已接受、付款单已支付并入账履约 | `finance.receipt.confirm` | required | V1.0 | 3.50 |
| `admin.transferProof.confirm` | POST | `/admin/transfer-proofs/{transferProofId}/confirm` | 确认到账：勾选已查到银行流水 + 银行流水号（规范化后唯一）+ 回显单号与金额；入账并履约 | `finance.receipt.confirm` | required | V1.0 | 3.48 |
| `admin.transferProof.reject` | POST | `/admin/transfer-proofs/{transferProofId}/reject` | 驳回凭证（原因 + 说明）：付款单回到待支付（凭证被驳回），对公有效期顺延，商家可重传 | `finance.receipt.reject` | required | V1.0 | 3.49 |
| `admin.transferProof.rejectReview` | POST | `/admin/transfer-proofs/{transferProofId}/reject-review` | 对公大额二人复核退回（说明必填）：清空第一确认内容，付款单回到待财务确认 | `finance.receipt.confirm` | required | V1.0 | 3.51 |

### [后台：客服工单](a08-support.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.quickReply.list` | GET | `/admin/quick-replies` | 快捷回复列表（由客服主管维护） | — | none | V1.1 | 3.14 |
| `admin.serviceTicket.list` | GET | `/admin/service-tickets` | 客服工单池：状态页签、工单号 / 商家 / 单号搜索、类型、优先级、来源、负责人、仅看响应超时；待处理类按时效排序 | — | none | V1.0 | 3.1 |
| `admin.serviceTicket.create` | POST | `/admin/service-tickets` | 登记工单（电话、在线客服来源）：商家、关联单号、类型、优先级、负责人（轮流或指定）、描述；直接进入处理中 | `service.ticket.register` | required | V1.0 | 3.3 |
| `admin.serviceTicket.summary` | GET | `/admin/service-tickets/summary` | 页首摘要与页签计数：待处理、响应超时、今日已解决 | — | none | V1.0 | 3.2 |
| `admin.serviceTicket.get` | GET | `/admin/service-tickets/{serviceTicketId}` | 工单详情：处理记录时间线（商家消息、回复、内部备注、系统事件）、服务时效、工单信息、关联业务 | — | none | V1.0 | 3.4 |
| `admin.serviceTicket.update` | PATCH | `/admin/service-tickets/{serviceTicketId}` | 改问题类型、优先级（带 lockVersion；只限未结状态） | `service.ticket.reply` | required | V1.0 | 3.11 |
| `admin.serviceTicket.assign` | POST | `/admin/service-tickets/{serviceTicketId}/assign` | 分配负责人（负责人为空时；必选原因）；企业微信提醒，时限不变 | `service.ticket.assign` | required | V1.0 | 3.8 |
| `admin.serviceTicket.close` | POST | `/admin/service-tickets/{serviceTicketId}/close` | 关闭工单（原因：重复、无效、商家撤回；说明必填）；关闭后不能再回复 | `service.ticket.close` | required | V1.0 | 3.7 |
| `admin.serviceTicket.entry.create` | POST | `/admin/service-tickets/{serviceTicketId}/entries` | 回复商家或写内部备注（≤500 字，可带图片；可勾选“此回复为处理方案”） | `service.ticket.reply` | required | V1.0 | 3.5 |
| `admin.serviceTicket.ref.create` | POST | `/admin/service-tickets/{serviceTicketId}/refs` | 处理中补关联业务（订购单、付款单、交付工单、广告；对象须属本门店，付款单按主体） | `service.ticket.reply` | required | V1.0 | 3.12 |
| `admin.serviceTicket.ref.batchRemove` | POST | `/admin/service-tickets/{serviceTicketId}/refs/remove` | 移除关联错的业务（物理删除，M95；审批单关联不可移除） | `service.ticket.reply` | required | V1.0 | 3.13 |
| `admin.serviceTicket.forceTransition` | POST | `/admin/service-tickets/{serviceTicketId}/force-transition` | 人工纠偏：把误关闭的客服工单重新打开（closed → processing；原因不少于 10 字） | `flow.admin.transition` | required | V1.0 | 3.10 |
| `admin.serviceTicket.reassign` | POST | `/admin/service-tickets/{serviceTicketId}/reassign` | 转派（目标员工启用且非当前负责人；必选原因，说明写入内部备注） | `service.ticket.transfer` | required | V1.0 | 3.9 |
| `admin.serviceTicket.submitResult` | POST | `/admin/service-tickets/{serviceTicketId}/submit-result` | 提交处理结果（必填），进入待商家确认，3 天未确认自动解决 | `service.ticket.reply` | required | V1.0 | 3.6 |

### [后台：内容运营与通知配置](a09-ops.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin.agreementConsent.list` | GET | `/admin/agreement-consents` | 同意记录检索：按协议、版本、商家用户、主体或门店、场景、关联单据（bizType + bizId，或单号）、时间范围（手机号只回脱敏值） | — | none | V1.0 | 3.7 |
| `admin.agreementConsent.get` | GET | `/admin/agreement-consents/{agreementConsentId}` | 同意记录证据详情（手机号、信用代码只回脱敏值） | — | none | V1.0 | 3.8 |
| `admin.agreementVersion.update` | PATCH | `/admin/agreement-versions/{agreementVersionId}` | 编辑草稿：生效时间、变更摘要、正文文件（Word 或 PDF）、是否需重新同意、法务审定勾选 | — | required | V1.0 | 3.4 |
| `admin.agreementVersion.schedule` | POST | `/admin/agreement-versions/{agreementVersionId}/schedule` | 保存为待生效（文件齐全、法务审定、生效时间晚于 10 分钟后）；会员与积分协议同事务建公告 | `assert-in-handler` | required | V1.0 | 3.5 |
| `admin.agreementVersion.withdraw` | POST | `/admin/agreement-versions/{agreementVersionId}/withdraw` | 撤回待生效版本（无同意记录且距生效 >10 分钟），内容复制为新草稿 | — | required | V1.0 | 3.6 |
| `admin.agreement.list` | GET | `/admin/agreements` | 协议清单（V1.0 6 份；服务商合作协议 partner 由 M9 推到 V1.1）：当前版本、待生效、草稿角标 | — | none | V1.0 | 3.1 |
| `admin.agreement.get` | GET | `/admin/agreements/{agreementKey}` | 协议详情：版本记录、正文、重新同意进度（已同意 / 应同意） | — | none | V1.0 | 3.2 |
| `admin.agreement.agreementVersion.create` | POST | `/admin/agreements/{agreementKey}/agreement-versions` | 新建协议版本草稿（版本号自动递增） | `assert-in-handler` | required | V1.0 | 3.3 |
| `admin.faq.list` | GET | `/admin/faqs` | 常见问题列表（按分类） | — | none | V1.1 | 3.40 |
| `admin.faq.create` | POST | `/admin/faqs` | 新增常见问题 | — | required | V1.1 | 3.41 |
| `admin.faq.update` | PATCH | `/admin/faqs/{faqId}` | 编辑常见问题 | — | required | V1.1 | 3.42 |
| `admin.faq.delete` | DELETE | `/admin/faqs/{faqId}` | 删除常见问题（建议软删） | — | required | V1.1 | 3.43 |
| `admin.homeBanner.list` | GET | `/admin/home-banners` | Banner 列表：标题、图片、跳转、时间窗、启用、点击数、派生状态（生效中、已排期、已结束、已停用）；可按是否已结束筛选 | — | none | V1.0 | 3.10 |
| `admin.homeBanner.summary` | GET | `/admin/home-banners/summary` | Banner 计数与上限：生效中、已排期、已结束、已停用张数与同时生效上限（OpsHome 页头“生效中 N 张 · 最多 5 张”） | — | none | V1.0 | 3.34 |
| `admin.homeBanner.create` | POST | `/admin/home-banners` | 新增 Banner（任意时刻同时生效 ≤5 张，按区间重叠校验） | — | required | V1.0 | 3.11 |
| `admin.homeBanner.batchReorder` | POST | `/admin/home-banners/reorder` | 拖动调整轮播顺序（提交全部未结束 Banner 的 id 数组；已结束的不参与、position 不变） | — | required | V1.0 | 3.12 |
| `admin.homeBanner.update` | PATCH | `/admin/home-banners/{homeBannerId}` | 编辑 Banner，或启用 / 停用（已结束的不可切换） | — | required | V1.0 | 3.13 |
| `admin.notice.list` | GET | `/admin/notices` | 公告列表 | — | none | V1.1 | 3.35 |
| `admin.notice.create` | POST | `/admin/notices` | 新建公告（保存草稿） | — | required | V1.1 | 3.36 |
| `admin.notice.update` | PATCH | `/admin/notices/{noticeId}` | 编辑公告 | — | required | V1.1 | 3.37 |
| `admin.notice.publish` | POST | `/admin/notices/{noticeId}/publish` | 立即或定时发布公告 | — | required | V1.1 | 3.38 |
| `admin.notice.unpublish` | POST | `/admin/notices/{noticeId}/unpublish` | 下线公告 | — | required | V1.1 | 3.39 |
| `admin.notificationDelivery.list` | GET | `/admin/notification-deliveries` | 发送日志：场景、通道、状态、业务对象、接收人、时间范围（页码分页；手机号脱敏） | `assert-in-handler` | none | V1.0 | 3.24 |
| `admin.notificationDelivery.resend` | POST | `/admin/notification-deliveries/{notificationDeliveryId}/resend` | 手动重发失败或跳过的外部通道投递（填原因；照常过守卫与限频） | `notify.resend` | required | V1.0 | 3.25 |
| `admin.notifyScene.list` | GET | `/admin/notify-scenes` | 消息模板页的订阅消息页签（17 个）与通知设置页的其他场景：触发时机文案、接收人、近 7 天发送与成功率、开关、示例预览；短信页签走 admin.smsTemplate.list | — | none | V1.0 | 3.18 |
| `admin.notifyScene.summary` | GET | `/admin/notify-scenes/summary` | 场景页签计数：订阅消息、其他场景（短信页签计数走 admin.smsTemplate.summary） | — | none | V1.0 | 3.19 |
| `admin.notifyScene.update` | PATCH | `/admin/notify-scenes/{sceneKey}` | 修改场景的外部通道开关与“补发短信”开关（带 lockVersion） | — | required | V1.0 | 3.20 |
| `admin.notifyScene.disable` | POST | `/admin/notify-scenes/{sceneKey}/disable` | 关闭场景总开关（须填原因） | `sys.super_admin` | required | V1.0 | 3.21 |
| `admin.notifyScene.enable` | POST | `/admin/notify-scenes/{sceneKey}/enable` | 打开场景总开关 | `sys.super_admin` | required | V1.0 | 3.22 |
| `admin.notifyScene.testSend` | POST | `/admin/notify-scenes/{sceneKey}/test-send` | 测试发送：订阅消息或该场景的补发短信，发到当前员工在参数 notify.test_recipients 里登记的 openid 或手机号（直发，每员工 5 次 / 分钟） | — | required | V1.0 | 3.23 |
| `admin.siteConfig.get` | GET | `/admin/site-configs/{configKey}` | 站点配置当前内容与草稿：首页推荐位（home_recommend）、商城配置（mall） | — | none | V1.0 | 3.14 |
| `admin.siteConfig.draft.replace` | PUT | `/admin/site-configs/{configKey}/draft` | 保存站点配置草稿（整份覆盖，带 lockVersion） | — | required | V1.0 | 3.15 |
| `admin.siteConfig.publish` | POST | `/admin/site-configs/{configKey}/publish` | 发布站点配置（base_rev_no 冲突返回 409；旧版本归档） | — | required | V1.0 | 3.16 |
| `admin.siteConfig.revision.list` | GET | `/admin/site-configs/{configKey}/revisions` | 站点配置版本记录（发布时间、发布人） | — | none | V1.0 | 3.17 |
| `admin.siteNotice.list` | GET | `/admin/site-notices` | 规则变更公告记录（套餐调整、计费参数、协议版本触发；只读） | `assert-in-handler` | none | V1.0 | 3.9 |
| `admin.smsTemplate.list` | GET | `/admin/sms-templates` | 短信模板：消息模板页的短信页签与通道配置页共用（模板编号、签名、状态、用途、触发时机、近 7 天发送、示例预览） | — | none | V1.0 | 3.30 |
| `admin.smsTemplate.summary` | GET | `/admin/sms-templates/summary` | 短信页签计数（OpsTemplates“短信 N”），另带按状态的计数 | — | none | V1.0 | 3.32 |
| `admin.smsTemplate.update` | PATCH | `/admin/sms-templates/{templateKey}` | 绑定短信模板编号与签名，启停模板（验证码类不可停用） | `sys.super_admin` | required | V1.0 | 3.31 |
| `admin.smsTemplate.testSend` | POST | `/admin/sms-templates/{templateKey}/test-send` | 按模板测试发送短信到当前员工在参数 notify.test_recipients 里登记的手机号（直发，用模板示例参数；含只用于直发的验证码类模板） | — | required | V1.0 | 3.33 |
| `admin.wxTemplateSlot.list` | GET | `/admin/wx-template-slots` | 订阅消息模板槽位：绑定的模板 ID、状态、连续失败数 | `sys.super_admin` | none | V1.0 | 3.26 |
| `admin.wxTemplateSlot.update` | PATCH | `/admin/wx-template-slots/{slotKey}` | 绑定或更换订阅消息模板 ID（字段定义须与场景一致） | `sys.super_admin` | required | V1.0 | 3.27 |
| `admin.wxTemplateSlot.disable` | POST | `/admin/wx-template-slots/{slotKey}/disable` | 人工停用槽位 | `sys.super_admin` | required | V1.0 | 3.28 |
| `admin.wxTemplateSlot.enable` | POST | `/admin/wx-template-slots/{slotKey}/enable` | 重新启用被自动或人工停用的槽位（fail_streak 清零） | `sys.super_admin` | required | V1.0 | 3.29 |

## 电脑端下载页

### [电脑端下载页](p01-portal.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `portal.ad.list` | GET | `/portal/ads` | 本门店待确认的广告列表（当前版本已推送、可在电脑上预览：查看方式含电脑端或属于开关兜底）；游标分页 | `ad.view` | none | V1.0 | 3.12 |
| `portal.ad.get` | GET | `/portal/ads/{adId}` | 广告只读预览的元数据：最新已推送版本的版本号、时长、分段标注、海报，并提示回小程序确认或提出修改意见；不含播放地址 | `ad.view` | none | V1.0 | 3.13 |
| `portal.ad.playbackUrls` | POST | `/portal/ads/{adId}/playback-urls` | 签发广告当前版本的播放地址（源文件，不加水印，A97；60 分钟）并留痕：每次写 audit_log 访问流，对象为广告版本 | `ad.view` | none | V1.0 | 3.14 |
| `portal.clientError.create` | POST | `/portal/client-errors` | 下载页前端错误上报（Sentry envelope）同源转发，收到即回 202 | — | none | V1.0 | 3.16 |
| `portal.file.create` | POST | `/portal/files` | 电脑端上传大文件的登记（V1.1 扩展位，V1.0 不做） | — | natural（uq_file_object_client_token_store） | V1.1 | 3.17 |
| `portal.licenseVerification.get` | GET | `/portal/license-verifications` | 授权书验真：按查询参数 code（验真码）与可选的 revNo（二维码里的版次）返回编号、版次、显示状态、授权方、被授权方（脱敏）、剧名、平台与账号、期限、内容指纹、当前版文件 SHA-256、签署方式与证书序列号，以及扫的那一版是否为当前版次 | — | none | V1.0 | 3.15 |
| `portal.orderItem.list` | GET | `/portal/order-items` | 本门店名下有生效中成片包或有待预览样片的订购项（剧名、集数、总大小、授权到期时间、是否有变更的集、待确认样片）；查询参数 tab（all \| downloadable \| sample_pending）；按成片包与样片推送时间的较晚者倒序；游标分页 | `delivery.download` | none | V1.0 | 3.6 |
| `portal.orderItem.downloadUrls` | POST | `/portal/order-items/{orderItemId}/download-urls` | 签发下载直链并留痕：kind = episode 取单集 15 分钟直链；kind = zip 触发或取 ZIP（就绪给 3 小时直链，未就绪返回打包中，失败后带 retry: true 才重打）；kind = publish_list 只查不建，ZIP 已就绪时取随 ZIP 生成的发布清单文件（15 分钟），否则返回当前打包状态、不触发打包 | `delivery.download` | none | V1.0 | 3.8 |
| `portal.orderItem.publishList.get` | GET | `/portal/order-items/{orderItemId}/publish-list` | 发布清单：合集名称、每集标题、话题、简介（生效成片包上的清单文本），供一键复制与生成文本文件 | `delivery.download` | none | V1.0 | 3.9 |
| `portal.orderItem.release.get` | GET | `/portal/order-items/{orderItemId}/release` | 成片下载页数据：当前成片包清单（集号、文件名、大小、相对上一包是否变更）、推送序号、下载授权状态与到期时间 | `delivery.download` | none | V1.0 | 3.7 |
| `portal.orderItem.sample.get` | GET | `/portal/order-items/{orderItemId}/sample` | 样片只读预览的元数据：当前已推送版本的 sampleId、版本号、时长、广告位标记、海报，并提示回小程序确认或提出修改意见；不含播放地址 | `sample.view` | none | V1.0 | 3.10 |
| `portal.portalTicket.create` | POST | `/portal/portal-tickets` | 电脑端创建扫码登录票据，返回 portalTicketId（uuid）、qrUrl（二维码内容，由 public_id 拼成）、shortCode、pairDigits、pollSecret（只出现这一次）、expiresAt、pollIntervalMs，页面据此渲染二维码、两位配对数字与倒计时 | — | none | V1.0 | 3.1 |
| `portal.portalTicket.get` | GET | `/portal/portal-tickets/{portalTicketId}` | 轮询票据状态（pending / approved / rejected / expired / consumed），凭请求头 X-Poll-Secret，只返回状态 | — | none | V1.0 | 3.2 |
| `portal.portalTicket.exchange` | POST | `/portal/portal-tickets/{portalTicketId}/exchange` | 凭 pollSecret 换取下载页会话：票据置 consumed，同事务建 portal_session 并 Set-Cookie __Host-lyx_portal；确认后密钥不符、尝试达上限或超过 60 秒时票据置 rejected，返回 200 与 status = rejected（作废随事务提交，A101 同一做法） | — | none | V1.0 | 3.3 |
| `portal.sample.playbackUrls` | POST | `/portal/samples/{sampleId}/playback-urls` | 签发样片水印版播放地址（60 分钟）并留痕：每次写 audit_log 访问流（target_type = sample），首次访问同事务回写 sample.first_viewed_at | `sample.view` | none | V1.0 | 3.11 |
| `portal.session.current.get` | GET | `/portal/sessions/current` | 当前下载页会话（GET /portal/sessions/current）：授权门店与主体名称、授权老板（脱敏）、能力点、到期时间；需要会话的页面加载时先调，401 时进入会话失效说明页 | — | none | V1.0 | 3.4 |
| `portal.session.current.delete` | DELETE | `/portal/sessions/current` | 电脑端退出（DELETE /portal/sessions/current）：写 portal_session.revoked_at 与 revoke_reason = portal_logout，写 auth_event，清除 Cookie | — | none | V1.0 | 3.5 |

## 外部回调与探活

### [外部回调与探活](h01-hooks.md)

| operationId | 方法 | 路径 | 用途 | 判权 | 幂等 | 版本 | 章节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `hooks.health.get` | GET | `/health` | 公开聚合健康（外部拨测，A42 保留）：status（ok / degraded）、version、time、db、redis、worker、probeAgeSec、flow；degraded 回 503，只回聚合值 | — | none | V1.0 | 3.13 |
| `hooks.healthz.get` | GET | `/healthz` | 存活检查：进程活着即 200，不查依赖；只回聚合状态 | — | none | V1.0 | 3.11 |
| `hooks.asr.mediaJob.wake` | POST | `/hooks/asr/media-jobs/{mediaJobId}` | 语音转写任务回调：校验查询参数 sig 后唤醒该媒体任务，结果以回查为准 | — | natural（uq_webhook_event_provider_event_id） | V1.0 | 3.8 |
| `hooks.ci.mediaJob.wake` | POST | `/hooks/ci/media-jobs/{mediaJobId}` | 数据万象任务回调：校验查询参数 sig 后唤醒该媒体任务（只把 next_run_at 置为当前），结果以回查任务接口为准 | — | natural（uq_webhook_event_provider_event_id） | V1.0 | 3.7 |
| `hooks.esign.event.receive` | POST | `/hooks/esign/events` | 电子签平台回调（V1.1；V1.0 不挂载路由，只在 webhook_event.provider 里声明） | — | natural（uq_webhook_event_provider_event_id） | V1.1 | 3.10 |
| `hooks.sms.statusReport.receive` | POST | `/hooks/sms/status-reports` | 短信状态回执：校验查询参数 token 后，按服务商流水号只追加写投递行的回执结果 | — | natural（uq_webhook_event_provider_event_id） | V1.0 | 3.9 |
| `hooks.wechat.message.verify` | GET | `/hooks/wechat/messages` | 小程序消息推送的服务器地址校验：校验 signature 后原样返回 echostr | — | none | V1.0 | 3.3 |
| `hooks.wechat.message.receive` | POST | `/hooks/wechat/messages` | 小程序消息推送：订阅消息事件（拒收、下发结果、弹窗）与内容安全异步结果；验签解密后落收件箱，5 秒内应答；客服消息被动回复转客服、不落库 | — | natural（uq_webhook_event_provider_event_id） | V1.0 | 3.4 |
| `hooks.wechatpay.refund.notify` | POST | `/hooks/wechatpay/refunds` | 微信退款结果回调：验签解密后落退款结果，驱动退款申请、付款单、开票申请与差异单 | — | natural（uq_webhook_event_provider_event_id） | V1.0 | 3.2 |
| `hooks.wechatpay.transaction.notify` | POST | `/hooks/wechatpay/transactions` | 微信支付结果回调：验签 → 解密 → 同事务落去重行与资金事实（收款交易成功）→ 提交后内联尝试入账与履约 → 应答 | — | natural（uq_webhook_event_provider_event_id） | V1.0 | 3.1 |
| `hooks.wecom.event.verify` | GET | `/hooks/wecom/events` | 企业微信回调地址校验：msg_signature 校验并解密 echostr 后返回 | — | none | V1.0 | 3.5 |
| `hooks.wecom.event.receive` | POST | `/hooks/wecom/events` | 企业微信客户联系事件（添加、半添加、删除外部联系人，被客户删除）：验签解密后落收件箱 | — | natural（uq_webhook_event_provider_event_id） | V1.0 | 3.6 |
| `hooks.internalHealth.finance.get` | GET | `/internal/health/finance` | 资金与计费存活指标（未入账超时、worker 心跳、定时器延迟、微信支付收件积压、证书剩余天数，以及计费的推进滞后、每日校验、违规、估值、履约受阻），仅内网，供云监控或独立探针每分钟拉取；degraded 回 503 | — | none | V1.0 | 3.14 |
| `hooks.internalHealth.flow.get` | GET | `/internal/health/flow` | 流程明细指标（最老未展开出站事件、最老待处理投递、投递死信数、定时器滞后、失败定时器数、关键类定时器连续失败数、卡住工单数），仅内网，供云监控或独立探针每分钟拉取；超过 P1 进 breaches、degraded 回 503，只超过 P2 进 warnings | — | none | V1.0 | 3.15 |
| `hooks.readyz.get` | GET | `/readyz` | 就绪检查：只反映进程已完成启动且未在排空，排空或收到 SIGTERM 后立即 503；不查数据库与 Redis；只回聚合状态 | — | none | V1.0 | 3.12 |

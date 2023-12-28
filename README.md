# subcvt-mannix

订阅转换后端 api 反向代理 + clash 自动移除无节点的分组和错误 uuid 的节点

默认 /sub 路径，默认转为 clash 订阅

- `https://c.7.cr?url={原订阅链接}`（随机后端 + 默认配置 + 默认参数）
- `https://c.7.cr/api.v1.mk?url={原订阅链接}`（指定后端）
- `https://c.7.cr/version`（指定路径）
- `https://c.7.cr/api.v1.mk/version`（指定后端和路径）

url 参数快捷方式

- `https://c.7.cr/{原订阅链接}`（原订阅链接需 URL 编码）
- `https://c.7.cr?{原订阅链接}`（原订阅链接无需 URL 编码，但如果存在 # 字符则必须编码，否则会被截断）
- `https://c.7.cr?config={远程配置}&{原订阅链接}`（同上）

github raw url 快捷方式

`https://c.7.cr/r/{owner}/{repo}/{ref}/{path}` -> `https://c.7.cr?url=https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`

其他用法与 https://github.com/tindy2013/subconverter/blob/master/README-cn.md 相同，如：

- `https://c.7.cr?config={远程配置}&url={原订阅链接}`（指定配置）
- `https://c.7.cr?target=mixed&url={原订阅链接}`（指定目标类型）

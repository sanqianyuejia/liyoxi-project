# 转给 api 的公共写法（gateway.conf.template 里各处 include）。
# Host 原样传：api 自己还要做一层 Host 判断（约定 C1）。X-Forwarded-For 是覆盖，不是追加：
# 客户端自己带来的那一段不可信，api 按“可信代理跳数 1”取值（D7 第 7.2 节）。
# 上游地址写成变量：每次按 resolver 重新解析，api 容器重建换了地址不用重启 gateway。
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $lyx_forwarded_proto;
proxy_set_header X-Request-Id $lyx_request_id;
proxy_connect_timeout 5s;
# api 自己 30 秒超时，这里多等 5 秒
proxy_read_timeout 35s;
proxy_send_timeout 35s;
# 应答放内存里转，不落临时文件（/tmp 是小内存盘）
proxy_buffers 16 32k;
proxy_max_temp_file_size 0;
proxy_pass http://$lyx_api_upstream;

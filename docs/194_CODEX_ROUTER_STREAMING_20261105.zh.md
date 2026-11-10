# 194 Codex 路由流读取修复

本轮修复非chunked SSE读取等待缓冲区的问题，并增加响应头之后的流预读计时。**不能据此宣称长上下文整体性能已修复**：真实主路由为chunked，主要等待仍在上游响应头之前。

## 证据与边界

- SQLite抽样的两条慢聊天：工具分发耗时中位数及p95均为0ms；工具完成至下一请求启动中位数约24/27ms；请求启动至本机路由响应头中位数约10.6/14.1秒。这是日志相关时序，包含代理及预读，不能等同模型纯计算耗时。
- 路由排队499样本均为0秒。上游可在请求上传后持续等待；流读取修复不能消除这部分时间，也不能强迫模型选择更多独立工具。
- 原版 `requests.iter_content(65536)` 对Content-Length和连接关闭定界的SSE，会攒住已flush的小事件。真实本机HTTP服务器用事件屏障阻止后续帧，旧版两项测试失败；改用urllib3公开 `HTTPResponse.read1` 后，在后续帧释放前收到首帧，逐字节核对完整输出。
- 194原有urllib3为2.0.7，没有该接口。升级副本固定为2.8.0，仅供路由进程加载；系统Python包没有替换。正常非SSE响应及现有curl传输保留原读取方式。
- 11项回归通过，包括真实转发方法、三种HTTP定界、gzip解码、超时异常、补丁幂等、输出前回退、有效输出后不重试、永久错误不重放。测试提取194现有方法，未把完整第三方源码提交进本仓库。

## 真实模型验证

用同一模型 `gpt-6.1-sol/high`，要求实际调用一次终端计算固定乘法，并核对答案与完成事件。原端口与独立候选端口并行执行，各一次：原版40.632秒，候选28.547秒，两者均退出0、一次终端调用且答案正确。样本量不足，不能用这个差值承诺提速比例；CLI与Desktop界面的差异也未消除。

候选两次上游请求均200：响应头等待11.448/12.644秒；流预读0.900/0.241秒；传输均为chunked。这进一步限制了本次缓冲修复对当前主路由的解释力。

生产部署后，实际Codex请求38.830秒、退出0、一次终端调用、答案正确。服务为active、enabled，用户Linger=yes；这些是持久启动配置证据，未实际重启服务器。长请求的新日志出现43.491–87.185秒响应头等待，多次流预读不足0.01秒，主要瓶颈仍未消除。

去掉路由专属代理的独立探针在100秒超时，虽执行过一次终端工具，但未完成整轮，不能算成功。其首请求响应头6.337秒、流预读67.151秒；单次结果不支持改生产代理，未采用。

生产部署及最终验收结果见[脱敏JSON](evidence/194-codex-router-streaming-20261105.json)；原始探针保留在194的 `/tmp/codex-streaming-ab-20261105`，未上传聊天或认证正文。

## 本轮错误切换与回滚

最初把“日志回退到duckduckport”误判成它已成功，曾临时将默认路由切到该提供方。三个真实请求均失败，错误明确为403及 `INSUFFICIENT_BALANCE`，立即恢复原四项路由值，服务恢复；随后确认kpoce能返回200。**回退日志不是成功证明**。最终未保留该切换，备用方余额问题未解决，也未更换认证信息。这个当前故障不能反推早先所有长聊天延迟都由余额造成。

## 复用、启动与回退

在目标Linux路由主机、已存在router.py及router.env的前提下：

1. 用 `scripts/requirements-codex-router-streaming.txt` 把依赖安装到该用户专属目录，例如 `python3 -m pip install --target "$HOME/.codex/router-deps/urllib3-2.8.0" -r scripts/requirements-codex-router-streaming.txt`；需要Python至少3.10。
2. 应用前运行 `PYTHONPATH="$HOME/.codex/router-deps/urllib3-2.8.0" ROUTER_TEST_SOURCE="$HOME/.codex/router.py" python3 scripts/test-codex-router-streaming.py`，应为11项通过、无跳过。未提供原版路由源码时，方法级集成测试会明确跳过，不算全链路通过。
3. `python3 scripts/patch-codex-router-streaming.py --router "$HOME/.codex/router.py" --check` 仅核对源码锚点；去掉 `--check` 应用补丁并自动备份。锚点不匹配直接失败，不静默修改其他版本。
4. 用同一PYTHONPATH运行 `python3 "$HOME/.codex/router.py" --check`；将该PYTHONPATH写入用户级 `codex-router.service` 的独立drop-in，再daemon-reload及restart。此步骤会中断路由中的模型请求，应在已授权的维护窗口操作；与业务项目进程无关。服务开机／用户登录时是否启动，仍沿用原服务启用状态。
5. 验收必须从实际Codex生产入口发起工具调用并核对结果。只看is-active或GET健康检查不足。
6. 回退时用补丁输出的备份恢复router.py，删除本次新增的 `40-streaming-deps.conf`，daemon-reload并restart；保留其他drop-in和原router.env。194还保存了不含凭据的 `~/.codex/backups/router-streaming-deployment.json`，记录本次源文件备份位置。

新增日志只有路由名、预读秒数、预读字节数和是否chunked；不打印提示词、工具正文或认证值。生产原始模型和压缩阈值未调整。

实现依据：[urllib3公开read1源码](https://github.com/urllib3/urllib3/blob/2.8.0/src/urllib3/response.py)；[OpenAI压缩指南](https://developers.openai.com/api/docs/guides/compaction)只说明压缩权衡，未作为调低生产阈值的性能保证。Stack Overflow搜索API返回空结果，补充搜索获得候选；原页403、答案API TLS失败，未将其当作已核实依据。

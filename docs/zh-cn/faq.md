### 常见问题

**一、管理员账号密码是什么？**

答：因为目前缺少引导安装的流程，所以管理员账号密码是系统随机生成的。具体可以在系统的启动日志中找到，如果是docker启动的，可以使用`docker logs zpan`进行查看。如果是systemd启动的，可以使用`journalctl -u zpan`进行查看。

**二、Docker安装之后如果修改配置文件？**
```bash
docker run -it zpan cat /etc/zpan/zpan.yml > /etc/zpan/zpan.yml
vi /etc/zpan/zpan.yml
docker run -it -v /etc/zpan:/etc/zpan zpan
```
答：可以把docker里的默认配置文件复制到宿主机上，在宿主机上修改调整之后再挂载到docker里。上面的命令仅供参考

**三、如何添加新用户**

答：目前仅支持用户自主注册，管理员添加用户的功能后续会支持，敬请关注~

**四、为什么不支持Windows系统？**

答：实际上Mac也没有提供二进制包，主要是考虑ZPan是一个服务端程序，再加上ZPan用到的一些依赖在支持多平台的情况下打包遇到一些麻烦，所以目前仅提供了一个Linux版本的Release，后续我们会考虑支持多平台。

### 用户反馈
如果您遇到的问题不再以上范围内，请到GitHub上创建一个[issue](https://github.com/saltbo/zpan/issue)进行反馈。

如果您在使用过程中发现了什么缺陷，或是有新的需求提议，也欢迎提交[issue](https://github.com/saltbo/zpan/issue)。

### 联系

<img src="https://static.saltbo.cn/images/image-20201110234507523.png" alt="image-20201110234507523" style="zoom: 25%;" />

扫码备注ZPan进入微信群，和我一起完善这个产品。

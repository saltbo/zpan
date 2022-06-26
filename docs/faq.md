# 常见问题

**一、Network Error是什么原因？**

答：如果您的网络状况正常，那么可能是没有进行跨域设置。请检查您使用的云平台是否需要手动设置跨域

**二、Docker安装之后如何修改配置文件？**

答：可以把docker里的默认配置文件复制到宿主机上，在宿主机上修改调整之后再挂载到docker里。下面的命令供参考

```bash
docker run -it zpan cat /etc/zpan/zpan.yml > /etc/zpan/zpan.yml
vi /etc/zpan/zpan.yml
docker run -it -v /etc/zpan:/etc/zpan zpan
```

**三、为什么接入点不支持ip+端口**

答：因为我们仅支持virtual-host-style，系统会自动把bucket名称拼接到接入点上，如果使用ip拼上去就错了。详见https://docs.aws.amazon.com/AmazonS3/latest/userguide/RESTAPI.html

**四、为什么不支持Windows系统？**

答：实际上Mac也没有提供二进制包，主要是考虑ZPan是一个服务端程序，再加上ZPan用到的一些依赖在支持多平台的情况下打包遇到一些麻烦，所以目前仅提供了一个Linux版本的Release，后续我们会考虑支持多平台。

## 用户反馈
如果您遇到的问题不再以上范围内，请到GitHub上创建一个[issue](https://github.com/saltbo/zpan/issue)进行反馈。

如果您在使用过程中发现了什么缺陷，或是有新的需求提议，也欢迎提交[issue](https://github.com/saltbo/zpan/issue)。

## 联系

- Telegram: https://t.me/zpanchannel
- 邮箱：saltbo@foxmail.com
- 微信：saltbo
  
<img src="/static/images/wechat.png" alt="wechat" style="zoom: 25%;" />

扫码备注ZPan进入微信群，和我一起完善这个产品。

## Linux
```bash
# install service
curl -sSLf https://dl.saltbo.cn/install.sh | sh -s zpan

# start service
systemctl start zpan

# check service status
systemctl status zpan

# set boot up
systemctl enable zpan
```

## Docker
```bash
docker run -it -p 8222:8222 -v /etc/zpan:/etc/zpan --name zpan saltbo/zpan
```

## CORS

!> Since we use browser-side direct transmission, there are cross-domain issues, please make the following cross-domain configuration

- Origin: http://your-domain
- AllowMethods: PUT
- AllowHeaders: content-type,content-disposition,x-amz-acl

### Usage
visit http://localhost:8222

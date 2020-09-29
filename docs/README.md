### Welcome
!> The project has just started, and the documentation is not complete, please help with PR

### Introduction
ZPan is committed to creating an unlimited speed network disk system, so we use the client to connect directly to cloud storage for design.

Currently ZPan supports all cloud storage platforms compatible with the S3 protocol. You can choose a platform you are familiar with to drive ZPan.

[Online Live](http://zpan.saltbo.cn)(username：demo，password：demo)

### How It Works

ZPan is essentially a URL signature server + a visual file browser.

Because we use a direct-link method for uploading and downloading, in order to ensure the security of uploading and downloading, all URLs used by the client to upload and download must be signed by the server.

Then, in order to conveniently manage the files uploaded by users, we need to develop a visual pseudo file system for file management.

- [saltbo/zpan](https://github.com/saltbo/zpan)
- [saltbo/zpan-front](https://github.com/saltbo/zpan-front)

### Features
- Not limited by server bandwidth
- Support all cloud storage compatible with S3 protocol
- Support file and folder management
- Support file and folder sharing (accessible without logging in)
- Support document preview and audio and video playback
- Support multi-user storage space control
- Support multiple languages

### Why Not ...?

#### NextCloud
NextCloud is a very easy to use network disk system. It can be said to be the predecessor in this field. But because it was born relatively early, it was designed base on the local file system. The speed of file transfer is limited by the speed of local network. This means that if you use NextCloud to build a network disk on a server with a bandwidth of one megabyte, the upper bound of the upload and download speed of the network disk is only one megabyte. If you want to increase the speed, you can only upgrade the bandwidth of the server, which is a big cost.

#### Cloudreve

Cloudreve is the only product I found before developing ZPan that meets my needs (uploads and downloads are not limited by bandwidth). However, Cloudreve was developed based on PHP at the time, and I was a bit disgusted about that it was troublesome to deploy, so I wanted to implement one by myself in Golang. However, due to some reasons, it was put on hold for more than a year. When I restarted ZPan and it was almost finished, I realized that Cloudreve also used Golang for refactoring during this year.

It is undeniable that Cloudreve has more functions than ZPan does. ZPan will be more restrained in features, as I always believe that more features are not always better. So, if you find that ZPan does not meet your needs, you can also try Cloudreve.

#### EyeblueTank

Blue Eye Cloud Disk was also found when I was looking for online storage products in the early days. Generally speaking, it fits my vision and is simple and easy to use. Unfortunately, it also belongs to the traditional network disk. I have communicated with his developers, and they have no plans to support cloud storage.

#### Z-File

Z-File is an online file catalog program that supports various object storage and local storage. Its target is to be a commonly used tools by individuals for downloading, or a public file library. It will not be developed in the direction of multiple accounts.

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/saltbo/gopkg/ginutil"

	"github.com/saltbo/zpan/internal/app/dao"
	"github.com/saltbo/zpan/internal/pkg/bind"
)

type StorageQuotaResource struct {
	sq *dao.StorageQuota
}

func NewStorageQuotaResource() *StorageQuotaResource {
	return &StorageQuotaResource{
		sq: dao.NewStorageQuota(),
	}
}

func (rs *StorageQuotaResource) Register(router *gin.RouterGroup) {
	router.GET("/storage-quotas", rs.findAll)

	router.PATCH("/storage-quotas/:id", rs.storageUpdate)
	//router.GET("/storage-quota", rs.myStorage)
}

func (rs *StorageQuotaResource) findAll(c *gin.Context) {
	//p := new(bind.QueryUser)
	//if err := c.BindQuery(p); err != nil {
	//	ginutil.JSONBadRequest(c, err)
	//	return
	//}
	//
	//list, err := rs.sq.FindAll(p.UIDs...)
	//if err != nil {
	//	ginutil.JSONServerError(c, err)
	//	return
	//}
	//
	//ginutil.JSONList(c, list, int64(len(list)))
}

func (rs *StorageQuotaResource) storageUpdate(c *gin.Context) {
	p := new(bind.BodyStorageQuota)
	if err := c.Bind(p); err != nil {
		ginutil.JSONBadRequest(c, err)
		return
	}

	//id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	//if err := rs.sq.UpdateMax(id, p.Max); err != nil {
	//	ginutil.JSONServerError(c, err)
	//	return
	//}

	ginutil.JSON(c)
}

func (rs *StorageQuotaResource) myStorage(c *gin.Context) {
	//userStorage, err := rs.sq.Find(authed.UidGet(c))
	//if err != nil {
	//	ginutil.JSONServerError(c, err)
	//	return
	//}

	//ginutil.JSONData(c, userStorage)
}

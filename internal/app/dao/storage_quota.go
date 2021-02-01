package dao


type StorageQuota struct {
}

func NewStorageQuota() *StorageQuota {
	return &StorageQuota{}
}

//func (u *StorageQuota) Create(uid int64) (*model.StorageQuota, error) {
//	user := &model.StorageQuota{Uid: uid, Max: defaultSize}
//	if err := gormutil.DB().Create(user).Error; err != nil {
//		return nil, err
//	}
//
//	return user, nil
//}
//
//func (u *StorageQuota) Find(uid int64) (*model.StorageQuota, error) {
//	user := new(model.StorageQuota)
//	if err := gormutil.DB().First(user, model.StorageQuota{Id: uid}).Error; err != nil {
//		return u.Create(uid)
//	}
//
//	return user, nil
//}
//
//func (u *StorageQuota) FindAll(uids ...string) (rets []model.StorageQuota, err error) {
//	rets = make([]model.StorageQuota, 0)
//	err = gormutil.DB().Where("id in (?)", uids).Find(&rets).Error
//	return
//}
//
//func (u *StorageQuota) UpdateMax(id int64, max uint64) error {
//	return gormutil.DB().Model(&model.StorageQuota{Id: id}).Update("max", max).Error
//}

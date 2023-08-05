package vfs

import (
	"context"
	"log"
	"time"

	"github.com/robfig/cron"
	"github.com/saltbo/zpan/internal/app/entity"
	"github.com/saltbo/zpan/internal/app/repo"
)

func (v *Vfs) matterCreatedEventHandler(matter *entity.Matter) error {
	c := cron.New()
	c.Start()
	return c.AddFunc("@every 10s", func() {
		ctx := context.Background()
		if err := v.uploader.UploadDone(ctx, matter); err != nil {
			return
		}

		_ = v.userRepo.UserStorageUsedIncr(ctx, matter)
		c.Stop()
	})
}

func (v *Vfs) matterDeletedEventHandler(matter *entity.Matter) error {
	return nil
}

func (v *Vfs) cleanExpiredMatters() {
	ctx := context.Background()
	matters, _, err := v.matterRepo.FindAll(ctx, &repo.MatterListOption{Draft: true})
	if err != nil {
		log.Printf("error getting the files of not uploaded: %s", err)
		return
	}

	for _, matter := range matters {
		if time.Since(matter.CreatedAt) < time.Hour*24 {
			continue
		}

		if err := v.matterRepo.Delete(ctx, matter.Id); err != nil {
			log.Printf("error deleting the file %s: %s", matter.FullPath(), err)
			return
		}

		log.Printf("deleted the file: %s", matter.FullPath())
	}
}

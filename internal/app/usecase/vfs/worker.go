package vfs

import (
	"github.com/saltbo/zpan/internal/app/repo"
)

type Worker struct {
	matterRepo repo.Matter
}

func NewWorker() *Worker {
	return &Worker{}
}

func (w *Worker) Start() {

}

func (w *Worker) cleanExpireMatters() {
	// matters, total, err := w.matterRepo.FindAll(context.Background(), &repo.MatterListOption{})
	// if err != nil {
	// 	return
	// }
	//
	// w.matterRepo.Delete()
}

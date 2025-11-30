.PHONY: run pull

IMG_TAG = sha-$(shell git rev-parse --short HEAD)

pull:
	IMG_TAG=$(IMG_TAG) docker compose pull webservice worker

run: pull
	IMG_TAG=$(IMG_TAG) docker compose up -d --wait --wait-timeout 60

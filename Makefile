.PHONY: run pull basemap

IMG_TAG = sha-$(shell git rev-parse --short HEAD)

pull:
	IMG_TAG=$(IMG_TAG) docker compose pull worker builder

run: pull
	IMG_TAG=$(IMG_TAG) docker compose up -d --wait --wait-timeout 900

# The basemap: heavy, rare, and not part of a release. Needed once before the
# first build, and monthly after that.
basemap:
	IMG_TAG=$(IMG_TAG) docker compose --profile basemap run --rm basemap

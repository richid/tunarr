import axios, { AxiosHeaders, AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { createWriteStream, promises as fs } from 'fs';
import { isString, isUndefined } from 'lodash-es';
import stream from 'stream';
import { directDbAccess } from '../dao/direct/directDbAccess.js';
import { CachedImage } from '../dao/direct/schema/CachedImage.js';
import { LoggerFactory } from '../util/logging/LoggerFactory.js';
import { FileCacheService } from './fileCacheService.js';

/**
 * Manager a cache in disk for external images.
 *
 * @class CacheImageService
 */
export class CacheImageService {
  private logger = LoggerFactory.child({
    caller: import.meta,
    className: this.constructor.name,
  });
  private cacheService: FileCacheService;
  private imageCacheFolder: string;

  constructor(fileCacheService: FileCacheService) {
    this.cacheService = fileCacheService;
    this.imageCacheFolder = 'images';
  }

  /**
   * Router interceptor to download image and update cache before pass to express.static return this cached image.
   *
   * GET /:hash - Hash is a full external URL encoded in base64.
   * eg.: http://{host}/cache/images/aHR0cHM6Ly8xO...cXVUbmFVNDZQWS1LWQ==
   *
   * @returns
   * @memberof CacheImageService
   */
  async routerInterceptor(
    req: FastifyRequest<{ Params: { hash: string } }>,
    res: FastifyReply,
  ) {
    try {
      const imgItem = await directDbAccess()
        .selectFrom('cachedImage')
        .where('hash', '=', req.params.hash)
        .selectAll()
        .executeTakeFirst();
      if (imgItem) {
        const file = await this.getImageFromCache(imgItem.hash);
        if (isUndefined(file) || !file.length) {
          const fileMimeType = await this.requestImageAndStore(imgItem);
          void res.header('content-type', fileMimeType);
        } else {
          void res.header('content-type', imgItem.mimeType);
        }
      }
    } catch (err) {
      return res.status(500).send('error');
    }
  }

  async getOrDownloadImageUrl(url: string) {
    return this.getOrDownloadImage(await this.registerImageOnDatabase(url));
  }

  async getOrDownloadImage(hash: string) {
    const imgItem = await directDbAccess()
      .selectFrom('cachedImage')
      .where('hash', '=', hash)
      .selectAll()
      .executeTakeFirst();
    if (imgItem) {
      if (
        !(await this.cacheService.exists(
          `${this.imageCacheFolder}/${imgItem.hash}`,
        ))
      ) {
        return await this.requestImageAndStore(imgItem);
      } else {
        return {
          path: `${this.cacheService.cachePath}/${this.imageCacheFolder}/${imgItem.hash}`,
          mimeType: imgItem.mimeType,
        };
      }
    }
    return;
  }

  private async requestImageAndStore(
    cachedImage: CachedImage,
  ): Promise<{ path: string; mimeType?: string }> {
    const requestConfiguration: AxiosRequestConfig = {
      method: 'get',
      url: cachedImage.url,
      responseType: 'stream',
    };

    this.logger.debug('Requesting original image file for caching');

    const response = await axios.request<stream.Readable>(requestConfiguration);

    const mimeType = (response.headers as AxiosHeaders).get('content-type');
    if (!isUndefined(mimeType) && isString(mimeType)) {
      this.logger.debug('Got image file with mimeType ' + mimeType);
      await directDbAccess()
        .insertInto('cachedImage')
        .values({
          ...cachedImage,
          mimeType,
        })
        .onConflict((oc) =>
          oc.column('hash').doUpdateSet({ ...cachedImage, mimeType }),
        )
        .executeTakeFirst();
    }

    const path = `${this.cacheService.cachePath}/${this.imageCacheFolder}/${cachedImage.hash}`;
    return new Promise((resolve, reject) => {
      response.data
        .pipe(createWriteStream(path))
        .on('close', () =>
          resolve({ path, mimeType: mimeType as string | undefined }),
        )
        .on('error', reject);
    });
  }

  /**
   * Get image from cache using an filename
   */
  async getImageFromCache(fileName: string): Promise<string | undefined> {
    try {
      return await this.cacheService.getCache(
        `${this.imageCacheFolder}/${fileName}`,
      );
    } catch (e) {
      this.logger.debug(e, `Image ${fileName} not found in cache.`);
      return;
    }
  }

  /**
   * Clear all files on {databasePath}/cache/images
   */
  async clearCache() {
    const cachePath = `${this.cacheService.cachePath}/${this.imageCacheFolder}`;
    await fs.rm(cachePath, { recursive: true, force: true });
    await fs.mkdir(cachePath);
  }

  async registerImageOnDatabase(imageUrl: string) {
    const encodedUrl = crypto
      .createHash('md5')
      .update(imageUrl)
      .digest('base64');
    await directDbAccess()
      .insertInto('cachedImage')
      .values({
        hash: encodedUrl,
        url: imageUrl,
      })
      .onConflict((oc) => oc.column('hash').doUpdateSet({ url: imageUrl }))
      .executeTakeFirst();
    return encodedUrl;
  }
}

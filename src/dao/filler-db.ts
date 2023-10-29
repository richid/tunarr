import fs from 'fs';
import { isUndefined } from 'lodash-es';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ChannelCache } from '../channel-cache.js';
import { ChannelDB } from './channel-db.js';

export class FillerDB {
  private folder: string;
  private cache: Record<string, any>;
  private channelDB: ChannelDB;
  private channelCache: ChannelCache;

  constructor(folder, channelDB, channelCache: ChannelCache) {
    this.folder = folder;
    this.cache = {};
    this.channelDB = channelDB;
    this.channelCache = channelCache;
  }

  async $loadFiller(id) {
    let f = path.join(this.folder, `${id}.json`);
    try {
      return await new Promise((resolve, reject) => {
        fs.readFile(f, (err, data) => {
          if (err) {
            return reject(err);
          }
          try {
            let j = JSON.parse(data.toString('utf-8'));
            j.id = id;
            resolve(j);
          } catch (err) {
            reject(err);
          }
        });
      });
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  async getFiller(id) {
    if (isUndefined(this.cache[id])) {
      this.cache[id] = await this.$loadFiller(id);
    }
    return this.cache[id];
  }

  async saveFiller(id, json) {
    if (isUndefined(id)) {
      throw Error('Mising filler id');
    }
    let f = path.join(this.folder, `${id}.json`);
    try {
      await new Promise((resolve, reject) => {
        let data: any = undefined;
        try {
          //id is determined by the file name, not the contents
          fixup(json);
          delete json.id;
          data = JSON.stringify(json);
        } catch (err) {
          return reject(err);
        }
        fs.writeFile(f, data, (err) => {
          if (err) {
            return reject(err);
          }
          resolve(void 0);
        });
      });
    } finally {
      delete this.cache[id];
    }
  }

  async createFiller(json) {
    let id = uuidv4();
    fixup(json);
    await this.saveFiller(id, json);
    return id;
  }

  async getFillerChannels(id) {
    let numbers = await this.channelDB.getAllChannelNumbers();
    let channels: any = [];
    await Promise.all(
      numbers.map(async (number) => {
        let ch = await this.channelDB.getChannel(number);
        let name = ch!.name;
        let fillerCollections = ch!.fillerCollections ?? [];
        for (let i = 0; i < fillerCollections.length; i++) {
          if (fillerCollections[i].id === id) {
            channels.push({
              number: number,
              name: name,
            });
            break;
          }
        }
        // ch = null;
      }),
    );
    return channels;
  }

  async deleteFiller(id) {
    try {
      let channels = await this.getFillerChannels(id);
      await Promise.all(
        channels.map(async (channel) => {
          console.log(
            `Updating channel ${channel.number} , remove filler: ${id}`,
          );
          let json = await this.channelDB.getChannel(channel.number);
          if (json?.fillerCollections) {
            json.fillerCollections = json?.fillerCollections?.filter((col) => {
              return col.id != id;
            });
          }
          if (json) {
            await this.channelDB.saveChannel(json);
          }
        }),
      );
      this.channelCache.clear();
      let f = path.join(this.folder, `${id}.json`);
      await new Promise((resolve, reject) => {
        fs.unlink(f, function (err) {
          if (err) {
            return reject(err);
          }
          resolve(void 0);
        });
      });
    } finally {
      delete this.cache[id];
    }
  }

  async getAllFillerIds(): Promise<any[]> {
    return await new Promise((resolve, reject) => {
      fs.readdir(this.folder, function (err, items) {
        if (err) {
          return reject(err);
        }
        let fillerIds: string[] = [];
        for (let i = 0; i < items.length; i++) {
          let name = path.basename(items[i]);
          if (path.extname(name) === '.json') {
            let id = name.slice(0, -5);
            fillerIds.push(id);
          }
        }
        resolve(fillerIds);
      });
    });
  }

  async getAllFillers() {
    let ids = await this.getAllFillerIds();
    return await Promise.all(ids.map(async (c) => this.getFiller(c)));
  }

  async getAllFillersInfo() {
    //returns just name and id
    let fillers = await this.getAllFillers();
    return fillers.map((f) => {
      return {
        id: f.id,
        name: f.name,
        count: f.content.length,
      };
    });
  }

  async getFillersFromChannel(channel) {
    // let f = [];
    // if (typeof channel.fillerCollections !== 'undefined') {
    //   f = channel.fillerContent;
    // }
    let loadChannelFiller = async (fillerEntry) => {
      let content = [];
      try {
        let filler = await this.getFiller(fillerEntry.id);
        content = filler.content;
      } catch (e) {
        console.error(
          `Channel #${channel.number} - ${channel.name} references an unattainable filler id: ${fillerEntry.id}`,
        );
      }
      return {
        id: fillerEntry.id,
        content: content,
        weight: fillerEntry.weight,
        cooldown: fillerEntry.cooldown,
      };
    };
    return await Promise.all(channel.fillerCollections.map(loadChannelFiller));
  }
}

function fixup(json) {
  if (isUndefined(json.content)) {
    json.content = [];
  }
  if (isUndefined(json.name)) {
    json.name = 'Unnamed Filler';
  }
}

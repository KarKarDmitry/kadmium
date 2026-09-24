import { Model, f } from '@karkardmitry/kadmium-core';
import { Bureau } from './bureau';

export class Country extends Model {
  name = f.string;
  gov = f.ref.target(Bureau, 'countries');
}
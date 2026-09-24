import { Model, f } from '@karkardmitry/kadmium-core';
import { Country } from './country';

export class Region extends Model {
  name = f.string;
  country = f.ref.target(Country, 'regions');
}